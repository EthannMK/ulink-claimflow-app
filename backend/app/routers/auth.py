from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from app import store
from app.security import verify_password, create_token
from app.models import Token, Role

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends()):
    u = store.get_by_username(form.username)
    if not u or not verify_password(form.password, u["password_hash"]) or not u["active"]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    token = create_token(u["username"], u["role"])
    return Token(access_token=token, role=Role(u["role"]), name=u["name"])
