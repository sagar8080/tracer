//! Tenant identity and permission policy. No transport or storage dependencies.
mod membership;
mod organization;
pub use membership::*;
pub use organization::Organization;
use serde::{Deserialize, Serialize};
use std::future::Future;
use uuid::Uuid;

#[derive(Clone, Copy, Debug)]
pub struct Actor {
    pub user_id: Uuid,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Owner,
    Admin,
    Planner,
    Member,
    Viewer,
}
#[derive(Clone, Copy, Debug)]
pub enum Permission {
    Read,
    Plan,
    Administer,
    Finance,
}
impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Admin => "admin",
            Self::Planner => "planner",
            Self::Member => "member",
            Self::Viewer => "viewer",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "owner" => Some(Self::Owner),
            "admin" => Some(Self::Admin),
            "planner" => Some(Self::Planner),
            "member" => Some(Self::Member),
            "viewer" => Some(Self::Viewer),
            _ => None,
        }
    }
    pub fn can_relinquish_ownership(self, next: Option<Self>, owner_count: i64) -> bool {
        self != Self::Owner || next == Some(Self::Owner) || owner_count > 1
    }
    pub fn can_manage(self, target: Self) -> bool {
        self == Self::Owner || (self == Self::Admin && !matches!(target, Self::Owner | Self::Admin))
    }
    pub fn permits(self, permission: Permission) -> bool {
        match permission {
            Permission::Read => true,
            Permission::Plan => matches!(self, Self::Owner | Self::Admin | Self::Planner),
            Permission::Administer | Permission::Finance => {
                matches!(self, Self::Owner | Self::Admin)
            }
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("Could not provision development identity")]
pub struct IdentityError;
/// Only for the explicit local development identity, not production login.
/// Idempotent by user id; must never change existing membership or roles.
pub trait DevelopmentIdentity: Send + Sync {
    fn ensure_development_actor(
        &self,
        actor: Actor,
    ) -> impl Future<Output = Result<(), IdentityError>> + Send;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ownership_and_finance_are_explicit() {
        assert!(!Role::Owner.can_relinquish_ownership(None, 1));
        assert!(!Role::Owner.can_relinquish_ownership(Some(Role::Admin), 1));
        assert!(Role::Owner.can_relinquish_ownership(None, 2));
        assert!(Role::Owner.can_relinquish_ownership(Some(Role::Owner), 1));
        for target in [
            Role::Owner,
            Role::Admin,
            Role::Planner,
            Role::Member,
            Role::Viewer,
        ] {
            assert!(Role::Owner.can_manage(target));
            assert_eq!(
                Role::Admin.can_manage(target),
                !matches!(target, Role::Owner | Role::Admin)
            );
            assert!(!Role::Planner.can_manage(target));
            assert_eq!(
                target.permits(Permission::Finance),
                matches!(target, Role::Owner | Role::Admin)
            );
        }
    }
    #[test]
    fn role_policy_preserves_read_plan_and_admin_boundaries() {
        for role in [
            Role::Owner,
            Role::Admin,
            Role::Planner,
            Role::Member,
            Role::Viewer,
        ] {
            assert!(role.permits(Permission::Read));
            assert_eq!(
                role.permits(Permission::Plan),
                matches!(role, Role::Owner | Role::Admin | Role::Planner)
            );
            assert_eq!(
                role.permits(Permission::Administer),
                matches!(role, Role::Owner | Role::Admin)
            );
        }
    }
}
