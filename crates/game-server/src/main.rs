use std::net::SocketAddr;
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();
    let db = std::env::var("ZECASINO_DB").unwrap_or_else(|_| "zecasino.sqlite".into());
    let dev = std::env::var("ZECASINO_DEV_CREDIT").is_ok_and(|v| v == "1");
    let app = zecasino_game_server::App::new(&db, dev);
    tokio::spawn(zecasino_game_server::crash::run(app.clone()));
    let addr: SocketAddr = std::env::var("ZECASINO_ADDR").unwrap_or_else(|_| "127.0.0.1:3200".into()).parse().unwrap();
    tracing::info!(%addr, dev_credit = dev, "game server listening");
    // No per-connection logging: we never record client IPs.
    axum::serve(tokio::net::TcpListener::bind(addr).await.unwrap(), zecasino_game_server::router(app)).await.unwrap();
}
