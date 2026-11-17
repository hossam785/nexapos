Get-PnpDevice -PresentOnly | Where-Object { $_.Class -in @('PrintQueue','Printer','USB','Ports') } | Format-Table FriendlyName, Class, Status -AutoSize
