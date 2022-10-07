#!/bin/bash

LAYER_NAME="merloc-gatekeeper"
REGIONS=( "ap-northeast-1" "ap-northeast-2" "ap-south-1" "ap-southeast-1" "ap-southeast-2" "ap-east-1" "ca-central-1" "eu-central-1" "eu-north-1" "eu-south-1" "eu-west-1" "eu-west-2" "eu-west-3" "sa-east-1" "us-east-1" "us-east-2" "us-west-1" "us-west-2" )
BUCKET_PREFIX="merloc-dist"
WORKSPACE_DIR="workspace"
RELEASE_ID="$(($(date +%s)))"
STATEMENT_ID_BASE="$LAYER_NAME-$RELEASE_ID"

function cleanup {
    rm -rf $WORKSPACE_DIR
}
trap cleanup EXIT

cleanup

mkdir -p $WORKSPACE_DIR
cp -r extensions $WORKSPACE_DIR
cp -r src $WORKSPACE_DIR/extensions/merloc-gatekeeper-ext
cp package.json $WORKSPACE_DIR/extensions/merloc-gatekeeper-ext
cp package-lock.json $WORKSPACE_DIR/extensions/merloc-gatekeeper-ext
cp tsconfig.json $WORKSPACE_DIR/extensions/merloc-gatekeeper-ext

pushd $WORKSPACE_DIR

pushd extensions/merloc-gatekeeper-ext
npm ci --omit=dev
npm run build
popd

zip -r "$LAYER_NAME.zip" . -x "extensions/merloc-gatekeeper-ext/src/*" -x "*/tsconfig.json"

for REGION in "${REGIONS[@]}"
do

    ARTIFACT_BUCKET="$BUCKET_PREFIX-$REGION"
    ARTIFACT_OBJECT="layers/merloc-gatekeeper/merloc-gatekeeper-$RELEASE_ID.zip"

    echo "Uploading '$LAYER_NAME.zip' at $ARTIFACT_BUCKET with path $ARTIFACT_OBJECT ..."

    aws s3 cp "./$LAYER_NAME.zip" "s3://$ARTIFACT_BUCKET/$ARTIFACT_OBJECT"  \
        --region "$REGION"  \
        --endpoint-url "https://s3.$REGION.amazonaws.com"

    echo "Uploaded '$LAYER_NAME.zip' to $ARTIFACT_BUCKET with path $ARTIFACT_OBJECT"

    ####################################################################################################################

    echo "Releasing '$LAYER_NAME' extension layer for region $REGION" \
         "from artifact $ARTIFACT_OBJECT at bucket $ARTIFACT_BUCKET ..."

    PUBLISHED_LAYER_VERSION=$(aws lambda publish-layer-version \
        --layer-name $LAYER_NAME \
        --description "$LAYER_NAME AWS Lambda extension layer" \
        --content S3Bucket=$ARTIFACT_BUCKET,S3Key=$ARTIFACT_OBJECT \
        --license-info "Apache License 2" \
        --region $REGION \
        --endpoint-url "https://lambda.$REGION.amazonaws.com" \
        --query 'Version')

    echo "Released '$LAYER_NAME' extension layer with version $PUBLISHED_LAYER_VERSION"

    # #################################################################################################################

    echo "Adding layer permission for '$LAYER_NAME' extension layer with version $PUBLISHED_LAYER_VERSION" \
         " to make it accessible by everyone ..."

    STATEMENT_ID="$STATEMENT_ID_BASE-$REGION"
    aws lambda add-layer-version-permission \
        --layer-name $LAYER_NAME \
        --version-number $PUBLISHED_LAYER_VERSION \
        --statement-id "$LAYER_NAME-$STATEMENT_ID" \
        --action lambda:GetLayerVersion \
        --principal '*' \
        --region $REGION \
        --endpoint-url "https://lambda.$REGION.amazonaws.com"

    echo "Added public access layer permission for '$LAYER_NAME' extension layer"

done

popd
