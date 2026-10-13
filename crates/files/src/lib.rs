//! Private file workflows. Database transactions never encompass object-store I/O.
mod model;
mod ports;
mod service;
pub use model::{File, MAX_FILE_BYTES, Upload};
pub use ports::{Error, ObjectLocation, ObjectStore, Repository, SignedRequest};
pub use service::{Download, ReservedUpload, Service};
