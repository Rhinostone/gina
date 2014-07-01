# GEENA

* * *

## Requirement
- node.js
- etc

* * *

## Commands

/!\ To use GEENA in command line, the terminal must have the administrator right. /!\

- help :  
	`geena -h | --help`
![Command line image - project init](help.png)

- version :  
	`geena -v | --version`
![Command line image - project init](version.png)

- init :  
	`geena -i | --init <project_name>`
![Command line image - project init](init-project.png)

- build :  
	`geena -b | --build [bundle name]`

- add :  
	`geena -a | --add <bundle name> [arguments]`
![Command line image - bundle added](add-bundle.png)
![Command line image - bundle result](add-bundle-result.png)

- delete :  
	`geena -d | --delete <bundle name>`
![Command line image - bundle removed](delete-bundle.png)

- restart :  
	`geena -r | --restart <bundle name>`

- start :  
	`geena -s | --start <bundle name> [mode] [options]`
	- dev :  
		`geena -s <bundle name> dev`
![Command line image - bundle removed](start-bundle.png)
Default IP (localhost), default port and default routes :
![Command line image - bundle removed](start-bundle-result.png)
To close the process, ctrl+C :
![Command line image - bundle removed](start-bundle-stop.png)
	- prod :  
		`geena -s <bundle name> prod`
	- staging :  
		`geena -s <bundle name> ???`
	- debug :  
		`geena -s <bundle name> <mode> --debug-brk=<port>`