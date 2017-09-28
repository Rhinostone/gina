# INSTALL

## Manual installation
Link globally gina to your user local env
```tty
cd /usr/local/bin
```
```tty
ln -s ../lib/node_modules/gina/bin/cli ./gina
```

Copy the `.gina` sample folder to you home directory

## Setup permissions

In order to run Gina properly with no re

Skip this step if you are running gina from `root` or through `sudo`
Create `/var/run/gina` (pid folder) and allow access to your user :


> **Attention:** this step must be repeated everytime the machine is restarted because `/var/run` folder will be cleanned up

e.g.: 
```tty
sudo mkdir /var/run/gina
```
```tty
sudo chown -R myuser:mygroup /var/run/gina
```

Then run the following command line to start the framework service

```tty
gina framework:start
```

hit `ctrl+c` to end the process
```tty
sudo chown <youruser>:<yourgroup> /var/run/gina
```

Now you can start the service with your usual user
```tty
gina framework:start
```