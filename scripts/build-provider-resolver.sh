#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/../.." && pwd)
runtime=${1:-linux-x64}
output=${2:-$repo_dir/web/provider-resolver}
dotnet publish "$repo_dir/backend/services/provider-resolver/Movly.ProviderResolver.csproj" -c Release -r "$runtime" --self-contained true -p:PublishSingleFile=true --artifacts-path "${TMPDIR:-/tmp}/movly-provider-publish-$runtime" -o "$output"
