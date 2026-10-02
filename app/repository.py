import json
import random
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.models import Base, ChatAudit, ParkingEvent, ParkingSpot, Reservation


settings = get_settings()
engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


class ParkingRepository:
    def __init__(self) -> None:
        self._rng = random.Random(20261002)
        self._last_changed_spots: list[dict] = []

    async def seed(self, force: bool = False) -> int:
        async with SessionLocal() as session:
            existing = list((await session.execute(select(ParkingSpot))).scalars())
            if existing and not force:
                self._last_changed_spots = []
                return len(existing)
            if existing:
                await session.execute(delete(ParkingSpot))
                await session.commit()

            created: list[ParkingSpot] = []
            idx = 1
            for floor, zone in [(0, "P1"), (0, "P2"), (1, "P3")]:
                for row in ["A", "B", "C"]:
                    for col in range(1, 7):
                        spot_id = f"{zone}-{row}{col:02d}"
                        if idx % 11 == 0:
                            status = "maintenance"
                        elif idx % 4 == 0:
                            status = "occupied"
                        else:
                            status = "available"
                        if row == "C" and col == 6:
                            spot_type, charger = "ev", 22.0
                        elif row == "A" and col <= 2:
                            spot_type, charger = "accessible", None
                        else:
                            spot_type, charger = "standard", None
                        created.append(ParkingSpot(
                            spot_id=spot_id,
                            zone=zone,
                            status=status,
                            spot_type=spot_type,
                            floor=floor,
                            row=row,
                            col=col,
                            distance_to_entrance_m=float(20 + floor * 35 + col * 7),
                            charger_kw=charger,
                            sensor_id=f"sensor-{idx:03d}",
                        ))
                        idx += 1
            session.add_all(created)
            await session.commit()
            self._last_changed_spots = []
            return len(created)

    async def snapshot(self) -> dict:
        async with SessionLocal() as session:
            result = await session.execute(
                select(ParkingSpot).order_by(ParkingSpot.zone, ParkingSpot.row, ParkingSpot.col)
            )
            spots = result.scalars().all()
            counts = {"available": 0, "occupied": 0, "reserved": 0, "maintenance": 0}
            data = []
            for spot in spots:
                counts[spot.status] = counts.get(spot.status, 0) + 1
                data.append({
                    "spot_id": spot.spot_id,
                    "zone": spot.zone,
                    "status": spot.status,
                    "spot_type": spot.spot_type,
                    "floor": spot.floor,
                    "row": spot.row,
                    "col": spot.col,
                    "distance_to_entrance_m": spot.distance_to_entrance_m,
                    "charger_kw": spot.charger_kw,
                })
            total = len(data)
            return {
                "lot_name": "ParkMind Demo Lot",
                "total": total,
                **counts,
                "occupancy_pct": round((counts["occupied"] / total * 100) if total else 0, 1),
                "updated_at": datetime.utcnow().isoformat() + "Z",
                "spots": data,
                "changed_spots": list(self._last_changed_spots),
            }

    async def available_spots(self, spot_type: str | None = None, zone: str | None = None) -> list[dict]:
        snapshot = await self.snapshot()
        spots = [spot for spot in snapshot["spots"] if spot["status"] == "available"]
        if spot_type:
            spots = [spot for spot in spots if spot["spot_type"] == spot_type]
        if zone:
            spots = [spot for spot in spots if spot["zone"].lower() == zone.lower()]
        return sorted(spots, key=lambda item: (item["distance_to_entrance_m"], item["spot_id"]))

    async def reserve(self, user_id: str, spot_id: str, duration_hours: int, vehicle_type: str = "car", needs_ev: bool = False, needs_accessible: bool = False) -> dict:
        async with SessionLocal() as session:
            result = await session.execute(select(ParkingSpot).where(ParkingSpot.spot_id == spot_id))
            spot = result.scalar_one_or_none()
            if not spot:
                raise ValueError(f"Spot {spot_id} does not exist")
            if spot.status != "available":
                raise ValueError(f"Spot {spot_id} is currently {spot.status}")
            if needs_ev and spot.spot_type != "ev":
                raise ValueError(f"Spot {spot_id} is not an EV charging spot")
            if needs_accessible and spot.spot_type != "accessible":
                raise ValueError(f"Spot {spot_id} is not an accessible spot")
            now = datetime.utcnow()
            reservation = Reservation(
                user_id=user_id,
                spot_id=spot_id,
                starts_at=now,
                ends_at=now + timedelta(hours=duration_hours),
                status="active",
                vehicle_type=vehicle_type,
                needs_ev=str(needs_ev).lower(),
                needs_accessible=str(needs_accessible).lower(),
            )
            spot.status = "reserved"
            session.add(reservation)
            session.add(ParkingEvent(event_type="reservation_created", spot_id=spot_id, payload=json.dumps({"user_id": user_id})))
            await session.commit()
            return {"reservation_id": reservation.id, "spot_id": spot_id, "ends_at": reservation.ends_at.isoformat() + "Z"}

    async def release(self, user_id: str, spot_id: str) -> dict:
        async with SessionLocal() as session:
            result = await session.execute(
                select(Reservation).where(
                    Reservation.user_id == user_id,
                    Reservation.spot_id == spot_id,
                    Reservation.status == "active",
                ).order_by(Reservation.id.desc())
            )
            reservation = result.scalars().first()
            if not reservation:
                raise ValueError("No active reservation found for that user and spot")
            reservation.status = "released"
            spot = await session.get(ParkingSpot, spot_id)
            if spot:
                spot.status = "available"
            session.add(ParkingEvent(event_type="reservation_released", spot_id=spot_id, payload=json.dumps({"user_id": user_id})))
            await session.commit()
            return {"spot_id": spot_id, "status": "released"}

    async def audit(self, request_id: str, query: str, response: str, routes: list[dict]) -> None:
        async with SessionLocal() as session:
            session.add(ChatAudit(request_id=request_id, query=query, response=response, routes_json=json.dumps(routes)))
            await session.commit()

    async def simulate_tick(self) -> list[dict]:
        async with SessionLocal() as session:
            result = await session.execute(
                select(ParkingSpot).where(ParkingSpot.status.in_(["available", "occupied"]))
            )
            spots = list(result.scalars().all())
            if not spots:
                self._last_changed_spots = []
                return []

            change_count = min(len(spots), self._rng.randint(2, 3))
            selected = self._rng.sample(spots, change_count)
            changed: list[dict] = []
            for spot in selected:
                previous_status = spot.status
                spot.status = "occupied" if previous_status == "available" else "available"
                changed.append({
                    "spot_id": spot.spot_id,
                    "from": previous_status,
                    "to": spot.status,
                })
                session.add(ParkingEvent(
                    event_type="occupancy_changed",
                    spot_id=spot.spot_id,
                    payload=json.dumps({
                        "from": previous_status,
                        "status": spot.status,
                    }),
                ))

            await session.commit()
            self._last_changed_spots = changed
            return changed
