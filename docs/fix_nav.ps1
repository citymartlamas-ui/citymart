$dir = "c:\Users\ACER\Desktop\citymart 2\public"
$files = Get-ChildItem -Path $dir -Filter "*.html"
foreach ($f in $files) {
    $content = [System.IO.File]::ReadAllText($f.FullName)
    $content = $content.Replace('municipio.html', 'turismo.html')
    $content = $content.Replace('>Municipio<', '>Turismo<')
    $content = $content.Replace('data-lucide="landmark" class="nav-icon"', 'data-lucide="compass" class="nav-icon"')
    [System.IO.File]::WriteAllText($f.FullName, $content)
}
Write-Host "Done updating nav links"
