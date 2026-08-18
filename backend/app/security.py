from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from app.config import settings
from app.models import Role
from app import store
from app.hashing import hash_password, verify_password  # noqa: F401

oauth2 = OAuth2PasswordBearer(tokenUrl="auth/login")


def create_token(username: str, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({"sub": username, "role": role, "exp": exp}, settings.jwt_secret, algorithm=settings.jwt_algorithm)

def get_current_user(token: str = Depends(oauth2)):
    cred_err = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        username = payload.get("sub")
    except JWTError:
        raise cred_err
    rec = store.get_by_username(username)
    if not rec or not rec["active"]:
        raise cred_err
    return rec

def require_role(*allowed: Role):
    def checker(user=Depends(get_current_user)):
        if user["role"] not in [r.value for r in allowed]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
        return user
    return checker
