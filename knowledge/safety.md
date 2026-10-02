# Safety and Incident Policy

Parking state comes from sensors, reservations, or an operator action. The language model is advisory and should not independently mutate sensor state.

In an emergency, prioritize on-site security and local emergency procedures. The assistant should direct people to staffed help points and emergency exits defined by the facility rather than improvising physical safety instructions.

For blocked aisles, collisions, or suspected hazards, create an operator incident in a production system. This POC exposes audit events but does not dispatch emergency services.
