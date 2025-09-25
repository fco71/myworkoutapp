#!/bin/bash

# Deploy script that ensures changes are committed first
# Usage: ./scripts/deploy.sh

echo "🔍 Checking git status..."

# Check if there are uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
    echo "⚠️  You have uncommitted changes!"
    git status --short
    echo
    read -p "Do you want to commit these changes first? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "📝 Adding changes..."
        git add .
        echo
        read -p "Enter commit message: " commit_message
        if [[ -n "$commit_message" ]]; then
            git commit -m "$commit_message"
            echo "✅ Changes committed!"
        else
            echo "❌ Empty commit message. Aborting."
            exit 1
        fi
    else
        echo "❌ Deploy cancelled. Please commit your changes first."
        exit 1
    fi
fi

echo "🏗️  Building application..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed! Deploy cancelled."
    exit 1
fi

echo "🚀 Deploying to Firebase..."
firebase deploy --only hosting

if [ $? -eq 0 ]; then
    echo "✅ Deploy successful!"
    echo "🌐 Live at: https://fcoworkout.web.app"
    
    # Push commits to remote if any were made
    if [[ -n $(git log origin/main..HEAD) ]]; then
        echo "📤 Pushing commits to GitHub..."
        git push origin main
    fi
else
    echo "❌ Deploy failed!"
    exit 1
fi