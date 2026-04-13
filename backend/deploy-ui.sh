#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="VibeShareStack"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_UI_DIR="$SCRIPT_DIR/web-ui"

echo "Looking up resources from stack $STACK_NAME..."

BUCKET_NAME=$(aws cloudformation describe-stack-resources \
  --stack-name "$STACK_NAME" \
  --logical-resource-id "WebUiBucket546EACCB" \
  --query "StackResources[0].PhysicalResourceId" \
  --output text)

DIST_ID=$(aws cloudformation describe-stack-resources \
  --stack-name "$STACK_NAME" \
  --logical-resource-id "WebUiDistribution2E25A267" \
  --query "StackResources[0].PhysicalResourceId" \
  --output text)

echo "Bucket: $BUCKET_NAME"
echo "Distribution: $DIST_ID"

echo "Syncing $WEB_UI_DIR -> s3://$BUCKET_NAME ..."
aws s3 sync "$WEB_UI_DIR" "s3://$BUCKET_NAME" --delete

echo "Invalidating CloudFront cache..."
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/*" \
  --query "Invalidation.Id" \
  --output text)

echo "Done! Invalidation $INVALIDATION_ID created (propagates in ~30s)"
