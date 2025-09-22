#!/usr/bin/env bash
set -euo pipefail

# Helper script: read OpenAI key from macOS Keychain and launch VS Code with it in the environment
# Usage:
#   ./scripts/code-with-openai.sh [key-service-name] [path]
# Defaults: key-service-name=openai, path=.

KEY_NAME="${1:-openai}"
TARGET_PATH="${2:-.}"

# read key from keychain
KEY="$(security find-generic-password -s "$KEY_NAME" -w 2>/dev/null || true)"

if [ -z "$KEY" ]; then
  echo "No key found in keychain for service '$KEY_NAME'."
  echo "To add one run:"
  echo "  security add-generic-password -s \"$KEY_NAME\" -a \"$USER\" -w \"<YOUR_OPENAI_KEY>\""
  exit 1
fi

export OPENAI_API_KEY="$KEY"
echo "Setting OPENAI_API_KEY via launchctl so GUI apps can read it..."
# launchctl setenv makes the variable available to GUI apps launched afterwards (until logout/reboot)
launchctl setenv OPENAI_API_KEY "$KEY"
echo "OPENAI_API_KEY set via launchctl (will persist until logout/reboot)."

echo "Attempting to open Visual Studio Code (by bundle identifier)..."
# Use bundle identifier to ensure we open the Microsoft VS Code app and not another app that provides a 'code' CLI
if open -b com.microsoft.VSCode "$TARGET_PATH" >/dev/null 2>&1; then
  echo "Opened Visual Studio Code via bundle id."
else
  echo "Could not open by bundle id, falling back to open -a \"Visual Studio Code\"."
  if open -a "Visual Studio Code" "$TARGET_PATH" >/dev/null 2>&1; then
    echo "Opened Visual Studio Code via app name."
  else
    echo "Failed to open Visual Studio Code. Verify VS Code is installed in /Applications or your user Applications folder."
  fi
fi

echo "If you want to remove the variable later run: launchctl unsetenv OPENAI_API_KEY"

echo "If the integrated terminal still doesn't show the variable, try restarting VS Code or opening a new integrated terminal."
