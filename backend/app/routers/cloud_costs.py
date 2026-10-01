"""Cloud costs dashboard endpoints — Super Admin only (see app/cloud_costs.py)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from app.models import Role
from app.security import require_role
from app import cloud_costs, audit

router = APIRouter(prefix="/api/cloud-costs", tags=["cloud-costs"])


@router.get("/overview")
async def overview(month: str = "", months: int = Query(6, ge=2, le=12), refresh: bool = False,
                   user=Depends(require_role(Role.super_admin))):
    """Google Cloud bill (billing export) + backup AI spend, by component / day / month, with forecast."""
    return await run_in_threadpool(cloud_costs.overview, month, months, refresh)


class CostSettings(BaseModel):
    dataset: str = ""
    budget_usd: float | None = None
    trial_credit_usd: float | None = None


@router.get("/settings")
def get_settings(user=Depends(require_role(Role.super_admin))):
    return {**cloud_costs.get_settings(), "default_dataset": cloud_costs.default_dataset()}


@router.put("/settings")
def put_settings(body: CostSettings, user=Depends(require_role(Role.super_admin))):
    try:
        saved = cloud_costs.save_settings(body.dataset, body.budget_usd, body.trial_credit_usd)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    audit.record("cloud_costs_settings", user.get("name") or user.get("username", ""),
                 detail=f"Billing dataset {saved['dataset']}, budget {saved['budget_usd']}, trial credit {saved['trial_credit_usd']}")
    return {**saved, "default_dataset": cloud_costs.default_dataset()}
