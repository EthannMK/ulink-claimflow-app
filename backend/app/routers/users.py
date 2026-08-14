from fastapi import APIRouter
from app.models import User, Role
router = APIRouter(prefix="/api")

_MOCK = [
    User(id="u1", name="Aung Ko", email="aung@ulink.com", role=Role.jd1, team="Intake"),
    User(id="u2", name="Su Su", email="susu@ulink.com", role=Role.jd2, team="Adjudication"),
    User(id="u5", name="Admin", email="admin@ulink.com", role=Role.admin, team="Ops"),
]

@router.get("/users", response_model=list[User])
def list_users():
    return _MOCK
