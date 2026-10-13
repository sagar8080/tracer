//! Compatibility launcher for explicit local development auto-migration and the
//! existing `kivo-api migrate` command. Schema execution belongs only to migrator.
use anyhow::{Context, ensure};
pub async fn run() -> anyhow::Result<()> {
    let path = std::env::current_exe()?
        .with_file_name(format!("kivo-migrator{}", std::env::consts::EXE_SUFFIX));
    let status = tokio::process::Command::new(path)
        .kill_on_drop(true)
        .status().await.context("Could not start kivo-migrator. Run cargo build --workspace first, or apply migrations separately and set KIVO_RUN_MIGRATIONS=0")?;
    ensure!(
        status.success(),
        "kivo-migrator failed; API startup aborted"
    );
    Ok(())
}
