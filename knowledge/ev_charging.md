# EV Charging Policy

EV bays are marked with spot_type=ev and provide a 22 kW charger in the demo dataset. A vehicle that needs charging should be directed to an EV bay instead of a standard bay.

Charging availability is separate from parking occupancy in a production design. A vehicle may be physically parked while a charger is faulted or unavailable. The POC models the charger as attached metadata so the architecture can later integrate an IoT charger service.

Do not promise charger availability beyond the live data supplied by the platform.
