from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    user_id: str
    username: str
    full_name: str
    role: str


class LogoutResponse(BaseModel):
    ok: bool
