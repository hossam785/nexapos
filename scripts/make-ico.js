const { execSync } = require('child_process')
const path = require('path')

const pngFile = path.join(__dirname, '..', 'public', 'NexalogoIcon.png')
const icoFile = path.join(__dirname, '..', 'build', 'logo.ico')

const psScript = [
  'Add-Type -AssemblyName System.Drawing;',
  `$png = [System.Drawing.Image]::FromFile('${pngFile.replace(/\\/g, '/')}');`,
  '$bmp = New-Object System.Drawing.Bitmap($png, 256, 256);',
  '$hIcon = $bmp.GetHicon();',
  '$icon = [System.Drawing.Icon]::FromHandle($hIcon);',
  `$fs = New-Object System.IO.FileStream('${icoFile.replace(/\\/g, '/')}', [System.IO.FileMode]::Create);`,
  '$icon.Save($fs);',
  '$fs.Close();',
  '$png.Dispose();',
  '$bmp.Dispose();'
].join(' ')

try {
  execSync(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`, { stdio: 'inherit' })
  console.log('Successfully updated build/logo.ico from NexalogoIcon.png')
} catch (e) {
  console.error('Failed to generate logo.ico:', e)
}
