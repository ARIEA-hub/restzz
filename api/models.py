# api/models.py
# SQLAlchemy ORM models — maps to the Supabase PostgreSQL schema

from sqlalchemy import (
    Column, Integer, String, Boolean, Float,
    DateTime, Date, Time, ForeignKey, Text
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from api.database import Base


class Restaurant(Base):
    __tablename__ = "restaurant"

    restaurant_id = Column(Integer, primary_key=True, index=True)
    name          = Column(String(255), nullable=False)
    location      = Column(String(500))
    status        = Column(String(20), default="open")   # 'open' | 'closed'
    latitude      = Column(Float)                        # Feature C
    longitude     = Column(Float)                        # Feature C
    created_at    = Column(DateTime(timezone=True), server_default=func.now())

    tables       = relationship("RestaurantTable", back_populates="restaurant")
    reservations = relationship("Reservation",     back_populates="restaurant")
    queue        = relationship("Queue",           back_populates="restaurant")


class Customer(Base):
    __tablename__ = "customer"

    customer_id         = Column(Integer, primary_key=True, index=True)
    name                = Column(String(255), nullable=False)
    email               = Column(String(255), unique=True, nullable=False, index=True)
    phone               = Column(String(20))
    password            = Column(String(255))
    is_guest            = Column(Boolean, default=False)
    is_verified         = Column(Boolean, default=False)   # Flow D
    latitude            = Column(Float)                    # Feature C
    longitude           = Column(Float)                    # Feature C
    location_updated_at = Column(DateTime(timezone=True))
    created_at          = Column(DateTime(timezone=True), server_default=func.now())

    reservations = relationship("Reservation", back_populates="customer")
    queue        = relationship("Queue",       back_populates="customer")


class Admin(Base):
    __tablename__ = "admin"

    admin_id      = Column(Integer, primary_key=True, index=True)
    restaurant_id = Column(Integer, ForeignKey("restaurant.restaurant_id"))
    name          = Column(String(255), nullable=False)
    email         = Column(String(255), unique=True, nullable=False, index=True)
    phone         = Column(String(20))
    password      = Column(String(255))
    role          = Column(String(50), default="staff")   # 'owner'|'manager'|'staff'
    is_verified   = Column(Boolean, default=False)         # Flow D
    created_at    = Column(DateTime(timezone=True), server_default=func.now())


class RestaurantTable(Base):
    __tablename__ = "restaurant_tables"

    table_id      = Column(Integer, primary_key=True, index=True)
    restaurant_id = Column(Integer, ForeignKey("restaurant.restaurant_id"), nullable=False)
    table_no      = Column(String(20), nullable=False)
    capacity      = Column(Integer, default=4)
    status        = Column(String(20), default="vacant")
    updated_at    = Column(DateTime(timezone=True), server_default=func.now())

    restaurant = relationship("Restaurant", back_populates="tables")


class Reservation(Base):
    __tablename__ = "reservation"

    reserve_id    = Column(Integer, primary_key=True, index=True)
    customer_id   = Column(Integer, ForeignKey("customer.customer_id"))
    restaurant_id = Column(Integer, ForeignKey("restaurant.restaurant_id"), nullable=False)
    table_id      = Column(Integer, ForeignKey("restaurant_tables.table_id"), nullable=True)
    group_size    = Column(Integer, nullable=False)
    reserve_date  = Column(Date, nullable=False)
    reserve_time  = Column(Time, nullable=False)
    status        = Column(String(20), default="reserved")
    created_at    = Column(DateTime(timezone=True), server_default=func.now())

    customer   = relationship("Customer",        back_populates="reservations")
    restaurant = relationship("Restaurant",      back_populates="reservations")


class Queue(Base):
    __tablename__ = "queue"

    queue_id      = Column(Integer, primary_key=True, index=True)
    restaurant_id = Column(Integer, ForeignKey("restaurant.restaurant_id"), nullable=False)
    customer_id   = Column(Integer, ForeignKey("customer.customer_id"))
    group_size    = Column(Integer, nullable=False)
    status        = Column(String(20), default="waiting")
    joined_at     = Column(DateTime(timezone=True), server_default=func.now())

    customer   = relationship("Customer",   back_populates="queue")
    restaurant = relationship("Restaurant", back_populates="queue")
