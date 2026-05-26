FROM oven/bun:1

# Install development tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user
ARG USERNAME=bun
ARG USER_UID=1000
ARG USER_GID=$USER_UID

RUN set -eux; \
    if ! getent group "$USERNAME" >/dev/null; then \
        groupadd --gid "$USER_GID" "$USERNAME"; \
    fi; \
    if ! id -u "$USERNAME" >/dev/null 2>&1; then \
        useradd --uid "$USER_UID" --gid "$USERNAME" -m "$USERNAME"; \
    fi; \
    echo "$USERNAME ALL=(root) NOPASSWD:ALL" > "/etc/sudoers.d/$USERNAME"; \
    chmod 0440 "/etc/sudoers.d/$USERNAME"

WORKDIR /workspace
RUN chown -R $USERNAME:$USERNAME /workspace

USER $USERNAME
