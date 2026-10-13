//! Planning rules and atomic workspace operations, independent of transport/providers.
mod capacity;
mod command;
mod people;
mod projects;
mod scheduling;
mod service;
pub use capacity::{Absence, WorkingCalendar, available_minutes_on, base_minutes_on, has_workday};
pub use command::{Command, Workspace};
pub use people::Person;
pub use projects::Project;
pub use scheduling::Assignment;
pub use service::{Error, Repository, Service};
