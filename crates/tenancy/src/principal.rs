use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Authenticated context created by a transport/verifier, never deserialized from a command.
#[derive(Clone, Copy, Debug)]
pub enum Principal {
    Human(super::Actor),
    Agent {
        id: Uuid,
        agent_id: Uuid,
        session_id: Uuid,
    },
}
impl Principal {
    pub fn id(self) -> Uuid {
        match self {
            Self::Human(actor) => actor.user_id,
            Self::Agent { id, .. } => id,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentMode {
    Observe,
    Propose,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentCapability {
    ReadSchedule,
    ReadCapacity,
    ProposeMove,
    ReadProposal,
}

/// A0 never grants live planning mutation or human self-service authority.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentScope {
    pub project_ids: Vec<Uuid>,
    pub capabilities: Vec<AgentCapability>,
    pub mode: AgentMode,
}
impl AgentScope {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.project_ids.is_empty()
            || self.project_ids.len() > 50
            || self.capabilities.is_empty()
            || self.capabilities.len() > 4
        {
            return Err("Choose 1–50 projects and at least one capability");
        }
        if self
            .project_ids
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != self.project_ids.len()
            || self
                .capabilities
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != self.capabilities.len()
        {
            return Err("Projects and capabilities must be unique");
        }
        if self.capabilities.contains(&AgentCapability::ProposeMove)
            && (self.mode != AgentMode::Propose
                || !self.capabilities.contains(&AgentCapability::ReadCapacity)
                || !self.capabilities.contains(&AgentCapability::ReadSchedule)
                || !self.capabilities.contains(&AgentCapability::ReadProposal))
        {
            return Err(
                "Move proposals require Propose mode, schedule, aggregate capacity and proposal access",
            );
        }
        Ok(())
    }
    pub fn narrows(&self, parent: &Self) -> bool {
        self.project_ids
            .iter()
            .all(|id| parent.project_ids.contains(id))
            && self
                .capabilities
                .iter()
                .all(|cap| parent.capabilities.contains(cap))
            && (self.mode == AgentMode::Observe || parent.mode == AgentMode::Propose)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn delegation_cannot_broaden_projects_tools_or_mode() {
        let project = Uuid::new_v4();
        let parent = AgentScope {
            project_ids: vec![project],
            capabilities: vec![AgentCapability::ReadSchedule],
            mode: AgentMode::Observe,
        };
        assert!(parent.narrows(&parent));
        let mut child = parent.clone();
        child.project_ids.push(Uuid::new_v4());
        assert!(!child.narrows(&parent));
        child = parent.clone();
        child.mode = AgentMode::Propose;
        assert!(!child.narrows(&parent));
        child = parent.clone();
        child.capabilities.push(AgentCapability::ReadCapacity);
        assert!(!child.narrows(&parent));
    }
}
