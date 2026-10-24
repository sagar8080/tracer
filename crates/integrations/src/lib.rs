//! Reviewed imports. Source content and model output are data, never authority.
mod model;
mod normalize;
mod ports;
mod reconcile;
pub use model::*;
pub use normalize::{effort_minutes, normalize, parse_date};
pub use ports::*;
pub use reconcile::{ReconcileContext, evaluate};
pub const MAX_ROWS: usize = 2_000;
pub const MAX_COLUMNS: usize = 64;
pub const MAX_CELLS: usize = 64_000;
pub const MAX_SHEETS: usize = 8;
pub const MAX_EXPANDED_BYTES: u64 = 32 * 1024 * 1024;
