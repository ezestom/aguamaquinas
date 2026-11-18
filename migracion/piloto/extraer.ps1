$ErrorActionPreference = 'Stop'
$base = [uri]'https://aguamaquinas.com.ar/'
$root = $PSScriptRoot
$catalog = (Invoke-WebRequest $base -TimeoutSec 25).Content

function To-Text([string]$html) {
    $html = $html -replace '<br\s*/?>|</p>|</li>|</div>', "`n" -replace '<[^>]+>', ''
    ([Net.WebUtility]::HtmlDecode($html) -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) -join "`n"
}

$items = foreach ($teaser in ([regex]::Matches($catalog, '(?s)<article data-history-node-id="(\d+)"[^>]*about="([^"]+)"[^>]*>.*?</article>') |
    Where-Object { $_.Groups[2].Value -notmatch '/aviso-importante$' } | Select-Object -First 10)) {
    $id = $teaser.Groups[1].Value
    $url = [uri]::new($base, $teaser.Groups[2].Value)
    $page = (Invoke-WebRequest $url -TimeoutSec 25).Content
    $article = [regex]::Match($page, '(?s)<article data-history-node-id="' + $id + '"[^>]*>.*?</article>').Value
    $title = To-Text ([regex]::Match($page, '(?s)<h1\b[^>]*>(.*?)</h1>').Groups[1].Value)
    $body = To-Text ([regex]::Match($article, '(?s)<div[^>]*field--name-body[^>]*>(.*)</article>').Groups[1].Value)
    if (!$title -or !$body) { throw "Ficha incompleta: $url" }
    $reference = [regex]::Match((To-Text $teaser.Value), '(?i)(?:referencia|stock|sock)\s*n\s*[°ºo.]?\s*(\d+)').Groups[1].Value
    $category = To-Text ([regex]::Match($article, '(?s)field--name-field-oportunidad[^>]*>\s*(?:<div[^>]*>\s*)?<a[^>]*>(.*?)</a>').Groups[1].Value)
    $photos = @()
    $photoDir = Join-Path $root "fotos/$id"
    New-Item -ItemType Directory -Path $photoDir -Force | Out-Null
    foreach ($src in ([regex]::Matches($article, '<img\b[^>]*\ssrc="([^"]+)"') | ForEach-Object { [Net.WebUtility]::HtmlDecode($_.Groups[1].Value) } | Select-Object -Unique)) {
        $photo = [uri]::new($base, $src)
        if ($photo.Host -ne $base.Host -or $photo.Scheme -ne 'https' -or $photo.AbsolutePath -notlike '/sites/default/files/*') { continue }
        $extension = [IO.Path]::GetExtension($photo.AbsolutePath).ToLowerInvariant()
        if ($extension -notin '.jpg','.jpeg','.png','.webp','.gif') { continue }
        $file = "fotos/$id/$($photos.Count + 1)$extension"
        $download = Invoke-WebRequest $photo -TimeoutSec 25 -OutFile (Join-Path $root $file) -PassThru
        if ($download.Headers['Content-Type'] -notlike 'image/*') { throw "Respuesta inesperada para $photo" }
        $photos += @{ archivo = $file; url = $photo.AbsoluteUri }
    }
    $videos = @([regex]::Matches($article, 'href="(https?://(?:[\w.-]+\.)?(?:youtube\.com|youtu\.be|vimeo\.com)/[^"]+)"') |
        ForEach-Object { [Net.WebUtility]::HtmlDecode($_.Groups[1].Value) } | Select-Object -Unique)
    [ordered]@{
        idDrupal = [int]$id
        referenciaPedro = $reference
        urlOrigen = $url.AbsoluteUri
        tituloOriginal = $title
        categoriaOriginal = $category
        descripcionOriginal = $body
        fotos = $photos
        videos = $videos
        precio = $null
        disponibilidadConfirmada = $false
    }
}
ConvertTo-Json -InputObject @($items) -Depth 8 | Set-Content -LiteralPath (Join-Path $root 'catalogo.json') -Encoding utf8
Write-Output "$(@($items).Count) fichas, $(@($items | ForEach-Object { $_.fotos }).Count) fotos"
