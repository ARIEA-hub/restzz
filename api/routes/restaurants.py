# api/routes/restaurants.py
# FastAPI restaurant routes — reads from Supabase PostgreSQL
# Bug B Fix: was returning hardcoded mock data, now queries real DB

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from api.database import get_db
from api.models   import Restaurant
from api.schemas  import RestaurantOut

router = APIRouter()


@router.get("/restaurants", response_model=List[RestaurantOut])
def get_restaurants(db: Session = Depends(get_db)):
    """
    Returns all restaurants from the database.
    Bug B fix: was previously returning two hardcoded mock entries.
    Now reads from the Supabase restaurant table.
    """
    restaurants = db.query(Restaurant).order_by(Restaurant.name).all()

    if not restaurants:
        # Return empty list rather than 500 error
        return []

    return restaurants


@router.get("/restaurants/open", response_model=List[RestaurantOut])
def get_open_restaurants(db: Session = Depends(get_db)):
    """Returns only restaurants with status='open'."""
    return db.query(Restaurant).filter(Restaurant.status == "open").all()


@router.get("/restaurants/{restaurant_id}", response_model=RestaurantOut)
def get_restaurant(restaurant_id: int, db: Session = Depends(get_db)):
    """Returns a single restaurant by ID."""
    r = db.query(Restaurant).filter(Restaurant.restaurant_id == restaurant_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    return r
