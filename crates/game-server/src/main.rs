use std::net::SocketAddr;
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();
    let db = std::env::var("ZECASINO_DB").unwrap_or_else(|_| "zecasino.sqlite".into());
    let dev = std::env::var("ZECASINO_DEV_CREDIT").is_ok_and(|v| v == "1");
    let demo = std::env::var("ZECASINO_DEMO").is_ok_and(|v| v == "1");
    // Dev credits mint unbacked chips: only allowed on a QA instance that cannot reach the wallet service,
    // so the real ledger's liabilities only ever come from on-chain deposits.
    if dev { assert!(std::env::var("ZEC_SERVICE_URL").is_err() && std::env::var("ZEC_INTERNAL_KEY").is_err(), "ZECASINO_DEV_CREDIT is QA-only: run it without wallet credentials, on its own database"); }
    let app = if demo {
        // A demo instance must never share the real ledger or reach the wallet service.
        assert!(std::env::var("ZEC_SERVICE_URL").is_err() && std::env::var("ZEC_INTERNAL_KEY").is_err(), "demo instance must run without wallet credentials");
        let mut a = zecasino_game_server::App::new(&db, false); std::sync::Arc::get_mut(&mut a).unwrap().demo = true; a
    } else { zecasino_game_server::App::new(&db, dev) };
    tokio::spawn(zecasino_game_server::crash::run(app.clone()));
    if app.zec.is_some() { tokio::spawn(zecasino_game_server::cashier::run(app.clone())); } else { tracing::warn!("ZEC_SERVICE_URL / ZEC_INTERNAL_KEY not set: cashier offline"); }
    let addr: SocketAddr = std::env::var("ZECASINO_ADDR").unwrap_or_else(|_| "127.0.0.1:3200".into()).parse().unwrap();
    tracing::info!(%addr, dev_credit = dev, demo, "game server listening");
    // No per-connection logging: we never record client IPs.
    axum::serve(tokio::net::TcpListener::bind(addr).await.unwrap(), zecasino_game_server::router(app)).await.unwrap();
}
