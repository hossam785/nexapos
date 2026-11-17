Get-PnpDevice -PresentOnly | Where-Object { $_.FriendlyName -like '*USB*' } | Select-Object FriendlyName, InstanceId, HardwareID
