import os
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import User
from backend.security import get_current_user as get_authenticated_user, require_admin

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.get("/config")
def get_auth_config():
    """Public auth configuration; provides existing application IM sign-in URL."""
    im_signin = os.getenv("IM_SIGNIN_URL") or os.getenv("IDENTITY_MANAGEMENT_SIGNIN_URL") or os.getenv("EXISTING_APP_IM_URL") or "/identity-management/signin"
    return {
        "im_signin_url": im_signin,
        "auth_type": "external_im"
    }

@router.get("/users")
def get_available_users(db: Session = Depends(get_db), current_user: User = Depends(get_authenticated_user)):
    """Returns list of users for switching personas in the UI."""
    from backend.security import LOCAL_PERSONAS, _ensure_local_persona
    # If the user is an SSO / external user, strictly return ONLY the authenticated SSO user.
    # The local admin account and local personas must NEVER be mixed into or exposed in an SSO user's session.
    if not current_user.is_local or current_user.username.lower() != "admin":
        return [current_user.to_dict()]

    seed_demo = os.getenv("SEED_DEMO_DATA", "false").strip().lower() in ("1", "true", "yes")
    if seed_demo:
        for uid in LOCAL_PERSONAS:
            _ensure_local_persona(uid, db)
        users = db.query(User).filter(User.active == True, User.is_local == True).all()
        return [u.to_dict() for u in users]

    # If the authenticated user is the local admin user, strictly return only the local admin user.
    return [current_user.to_dict()]

@router.get("/current")
def get_current_user(
    current_user: User = Depends(get_authenticated_user),
    db: Session = Depends(get_db)
):
    """
    Returns the authenticated user information, project boundaries, and role.
    """
    # Add user's assignment group IDs
    group_ids = [m.group_id for m in current_user.memberships]
    data = current_user.to_dict()
    data["assignment_group_ids"] = group_ids
    from backend.security import get_user_project_boundaries
    data["project_boundaries"] = get_user_project_boundaries(current_user, db)
    data["enterprise_name"] = os.getenv("ENTERPRISE_NAME", os.getenv("ACCENTURE_ENTERPRISE_NAME", "Accenture Enterprise"))
    return data
