#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

socket_exists() {
  local socket_path="$1"

  if [ -n "${NEMOCLAW_TEST_SOCKET_PATHS:-}" ]; then
    case ":$NEMOCLAW_TEST_SOCKET_PATHS:" in
      *":$socket_path:"*) return 0 ;;
    esac
  fi

  [ -S "$socket_path" ]
}

find_colima_docker_socket() {
  local home_dir="${1:-${HOME:-/tmp}}"
  local socket_path

  for socket_path in \
    "$home_dir/.colima/default/docker.sock" \
    "$home_dir/.config/colima/default/docker.sock"
  do
    if socket_exists "$socket_path"; then
      printf '%s\n' "$socket_path"
      return 0
    fi
  done

  return 1
}

find_docker_desktop_socket() {
  local home_dir="${1:-${HOME:-/tmp}}"
  local socket_path="$home_dir/.docker/run/docker.sock"

  if socket_exists "$socket_path"; then
    printf '%s\n' "$socket_path"
    return 0
  fi

  return 1
}

detect_docker_host() {
  if [ -n "${DOCKER_HOST:-}" ]; then
    printf '%s\n' "$DOCKER_HOST"
    return 0
  fi

  local home_dir="${1:-${HOME:-/tmp}}"
  local socket_path

  if socket_path="$(find_colima_docker_socket "$home_dir")"; then
    printf 'unix://%s\n' "$socket_path"
    return 0
  fi

  if socket_path="$(find_docker_desktop_socket "$home_dir")"; then
    printf 'unix://%s\n' "$socket_path"
    return 0
  fi

  return 1
}
