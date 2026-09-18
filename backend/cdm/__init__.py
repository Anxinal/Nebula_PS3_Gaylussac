"""Hierarchical condition-monitoring stack for Problem Statement 3.

    file -> SubsystemRouter -> expert for that subsystem -> Verdict

Stage 1 (``router.py``) identifies which of the four rail subsystems a file
belongs to. Stage 2 (``experts/``) runs that subsystem's own tree model and
decides whether a fault is present.
"""

__version__ = "0.2.0"

SUBSYSTEMS = ("rail", "shm", "acv", "door")
