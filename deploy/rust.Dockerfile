# Builds one Rust binary from the workspace. Build arg BIN = zecasino-game-server | zecasino-zec-service
FROM rust:1-bookworm AS build
ARG BIN
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --release -p ${BIN} && cp target/release/${BIN} /app

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates sqlite3 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /usr/local/bin/app
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
WORKDIR /data
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
