# api/schemas.py
# Pydantic schemas for FastAPI request validation and response serialization

from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import date, time, datetime


class RestaurantOut(BaseModel):
    restaurant_id: int
    name:          str
    location:      Optional[str]
    status:        str
    latitude:      Optional[float]
    longitude:     Optional[float]

    class Config:
        from_attributes = True   # Allows reading from SQLAlchemy ORM objects


class CustomerCreate(BaseModel):
    name:     str
    email:    EmailStr
    phone:    str
    password: str = Field(min_length=6)


class CustomerOut(BaseModel):
    customer_id: int
    name:        str
    email:       str
    phone:       Optional[str]
    is_verified: bool

    class Config:
        from_attributes = True


class ReservationCreate(BaseModel):
    customer_id:   int
    restaurant_id: int
    group_size:    int = Field(ge=1, le=20)
    reserve_date:  date
    reserve_time:  time


class ReservationOut(BaseModel):
    reserve_id:   int
    group_size:   int
    status:       str
    reserve_date: date
    reserve_time: time

    class Config:
        from_attributes = True


class LocationUpdate(BaseModel):
    customer_id: int
    latitude:    float = Field(ge=-90,  le=90)
    longitude:   float = Field(ge=-180, le=180)


class WaitTimePrediction(BaseModel):
    party_size:        int = Field(ge=1)
    queue_length:      int = Field(ge=0)
    tables_available:  int = Field(ge=0)
