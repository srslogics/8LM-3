from typing import Annotated

from fastapi import Depends, Request

from app.core.errors import AppError
from app.core.security import COOKIE


def services(request: Request):
    return request.app.state.services


async def current_user(request: Request):
    user = await services(request).auth.session(request.cookies.get(COOKIE))
    if not user:
        raise AppError("Please log in.", 401)
    return user


User = Annotated[dict, Depends(current_user)]
