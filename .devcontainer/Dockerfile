FROM oven/bun:1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl git sudo \
    && rm -rf /var/lib/apt/lists/*

ARG USERNAME=bun
ARG USER_UID=1000
ARG USER_GID=$USER_UID

RUN set -eux; \
    if ! getent group "$USERNAME" >/dev/null; then groupadd --gid "$USER_GID" "$USERNAME"; fi; \
    if ! id -u "$USERNAME" >/dev/null 2>&1; then useradd --uid "$USER_UID" --gid "$USERNAME" -m "$USERNAME"; fi; \
    echo "$USERNAME ALL=(root) NOPASSWD:ALL" > "/etc/sudoers.d/$USERNAME"; \
    chmod 0440 "/etc/sudoers.d/$USERNAME"

WORKDIR /workspace
RUN chown -R "$USERNAME:$USERNAME" /workspace

ENV BUN_INSTALL=/opt/justice/bun
ENV RUSTUP_HOME=/opt/justice/rustup
ENV CARGO_HOME=/opt/justice/cargo
ENV PATH=/opt/justice/bun/bin:/opt/justice/cargo/bin:${PATH}

RUN install -d -o root -g root -m 0755 \
    "$BUN_INSTALL" "$BUN_INSTALL/bin" \
    && install -d -o "$USERNAME" -g "$USERNAME" -m 0755 \
    "$RUSTUP_HOME" "$CARGO_HOME" "$CARGO_HOME/bin"

USER root
RUN bun add --global --exact opencode-ai@1.18.29
RUN test "$(whoami)" = "root" \
    && command -v opencode \
    && test "$(opencode --version)" = "1.18.29"

RUN curl --proto '=https' --tlsv1.2 --fail --silent --show-error https://sh.rustup.rs \
    | RUSTUP_HOME="$RUSTUP_HOME" CARGO_HOME="$CARGO_HOME" \
      sh -s -- -y --no-modify-path --profile minimal --default-toolchain 1.85.1
RUN rustup toolchain install 1.85.1 \
    --profile minimal \
    --component rustfmt \
    --component clippy \
    --target x86_64-unknown-linux-gnu \
    && rustup default 1.85.1 \
    && test "$(rustup show active-toolchain | cut -d' ' -f1)" = "1.85.1-x86_64-unknown-linux-gnu"

USER $USERNAME
