#!/bin/sh

set -eu

# list supported security features for every generator
# java -jar openapi-generator-cli-4.3.0.jar list | grep SERVER -A 1000 | grep DOCUMENTATION -B 1000 | head -n -3 | tail -n +2 | sed -E 's/.*- (.*)/\1/' | xargs -I {} sh -c 'echo {}; java -jar openapi-generator-cli-4.3.0.jar config-help --generator-name {} --feature-set | grep SecurityFeature -A 1000 | grep WireFormatFeature -B 1000 | head -n -1 | tail -n +2
[ -f openapi-generator-cli-4.3.0.jar ] || wget https://repo1.maven.org/maven2/org/openapitools/openapi-generator-cli/4.3.0/openapi-generator-cli-4.3.0.jar

[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
python3 -c "import yaml" >/dev/null 2>&1 || pip3 install pyyaml

rm -rf gen/
mkdir -p gen/

rm -rf src/openapi/
mkdir -p src/openapi/

# typescript client
java -jar openapi-generator-cli-4.3.0.jar generate \
    --input-spec openapi-spec-merged.yml \
    --api-package api \
    --invoker-package invoker \
    --model-package models \
    --generator-name typescript-node \
    --strict-spec true \
    --output gen/client-typescript/ \
    --config openapi-config-client-typescript.yml
cp -vr gen/client-typescript/api src/openapi/
cp -vr gen/client-typescript/models src/openapi/model
cp -vr gen/client-typescript/api.ts src/openapi/
# intentional, codegen can't even gen code right
ln -s model/ src/openapi/models
# thing can't even generate syntatically correct code
sed -E -i -e "s/\} +\{/}, {/" src/openapi/model/*

# tsc complains about not all files being in src
rm -rf gen/