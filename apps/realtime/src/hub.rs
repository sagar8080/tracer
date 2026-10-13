//! One coalescing revision watcher per active organization, not one poll per socket.
use kivo_postgres::Postgres;
use kivo_realtime::Repository;
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::{Mutex, watch};
use uuid::Uuid;
#[derive(Clone, Default)]
pub struct Hub(Arc<Mutex<HashMap<Uuid, watch::Sender<i64>>>>);
impl Hub {
    pub async fn subscribe(&self, org: Uuid) -> watch::Receiver<i64> {
        self.0
            .lock()
            .await
            .entry(org)
            .or_insert_with(|| watch::channel(-1).0)
            .subscribe()
    }
    pub async fn poll(self, db: Postgres) {
        let mut clock = tokio::time::interval(Duration::from_secs(1));
        loop {
            clock.tick().await;
            let ids = {
                let mut map = self.0.lock().await;
                map.retain(|_, s| s.receiver_count() > 0);
                map.keys().copied().collect::<Vec<_>>()
            };
            if ids.is_empty() {
                continue;
            }
            match db.revisions(&ids).await {
                Ok(revisions) => {
                    let map = self.0.lock().await;
                    for (id, revision) in revisions {
                        if let Some(sender) = map.get(&id) {
                            sender.send_if_modified(|old| {
                                if *old == revision {
                                    false
                                } else {
                                    *old = revision;
                                    true
                                }
                            });
                        }
                    }
                }
                Err(_) => {
                    for sender in self.0.lock().await.values() {
                        sender.send_replace(-2);
                    }
                }
            }
        }
    }
}
