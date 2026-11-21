FROM harbor.graydove.cn/library/node:22-alpine AS builder

ARG RUST_VERSION=1.96.1
ARG RUSTUP_VERSION=1.29.3
ENV RUSTUP_HOME=/opt/rustup \
    CARGO_HOME=/opt/cargo \
    PATH=/opt/cargo/bin:$PATH

RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|' /etc/apk/repositories \
    && apk add --no-cache build-base mingw-w64-gcc \
    && cd /tmp \
    && rustup_url="https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-musl/rustup-init" \
    && wget -q "$rustup_url" \
    && wget -q "$rustup_url.sha256" \
    && sha256sum -c rustup-init.sha256 \
    && chmod +x rustup-init \
    && ./rustup-init -y --no-modify-path --profile minimal --default-toolchain "$RUST_VERSION" --target x86_64-pc-windows-gnu \
    && rm rustup-init rustup-init.sha256

WORKDIR /src
COPY desktop/ desktop/
COPY app/favicon.ico app/favicon.ico
COPY public/brand/poe2-filter.png public/brand/poe2-filter.png
RUN --mount=type=cache,target=/opt/cargo/registry \
    cargo build --manifest-path desktop/Cargo.toml --release --target x86_64-pc-windows-gnu --locked

FROM scratch
COPY --from=builder /src/desktop/target/x86_64-pc-windows-gnu/release/poe2-filter-client.exe /poe2-filter-client.exe
CMD ["/poe2-filter-client.exe"]
