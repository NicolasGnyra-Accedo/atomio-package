var Archiver = require('archiver');
var CompositeDisposable = require('atom').CompositeDisposable;
var Directory = require('atom').Directory;
var fs = require('fs');
var request = require('request');

module.exports = {
    rokuIpAddress:          null,
    rokuDevPassword:        null,
    rokuDevUsername:        null,
    disposable:             null,
    excludedPaths:          null,
    outputDirectory:        null,
    skinName:               null,
    envName:                null,
    separator:              null,
    filesCache:             {},

    config: {
        rokuIpAddress: {
            title       : 'IP Address',
            description : 'IP Address of Roku device on the local network.',
            type        : 'string',
            default     : '192.168.0.0',
            order       : 1
        },
        rokuDevUsername: {
            title       : 'Username',
            description : 'Developer username.',
            type        : 'string',
            default     : 'rokudev',
            order       : 2
        },
        rokuDevPassword: {
            title       : 'Password',
            description : 'Developer password.',
            type        : 'string',
            default     : 'test',
            order       : 3
        },
        outputDirectory: {
            title       : 'Location of package',
            description : 'Where the output zip file should be saved.',
            type        : 'string',
            default     : 'out',
            order       : 4
        },
        excludedPaths: {
            title       : 'Folders to exclude',
            description : 'Separate multiple folders using commas.',
            type        : 'string',
            default     : 'out',
            order       : 5
        },
        skinName: {
            title       : 'Skin name',
            description : 'Name of folder containing skin.',
            type        : 'string',
            default     : '',
            order       : 6
        },
        envName: {
            title       : 'Environment name',
            description : 'Name of environment (e.g. dev, staging, production)',
            type        : 'string',
            default     : 'dev',
            order       : 7
        }
    },
    
    activate: function(state) {
        this.rokuIpAddress      = atom.config.get('roku-atom.rokuIpAddress');
        this.rokuDevUsername    = atom.config.get('roku-atom.rokuDevUsername');
        this.rokuDevPassword    = atom.config.get('roku-atom.rokuDevPassword');
        this.excludedPaths      = atom.config.get('roku-atom.excludedPaths');
        this.outputDirectory    = atom.config.get('roku-atom.outputDirectory');
        this.skinName           = atom.config.get('roku-atom.skinName');
        this.envName            = atom.config.get('roku-atom.envName');
        this.disposable         = new CompositeDisposable();

        this.disposable.add(atom.commands.add('atom-workspace', {
            'roku-atom:rokuDeploy': (function(_this) {
                return function() {
                    _this.rokuDeployRun();
                };
            })(this)
        }));
    },
    deactivate: function() {
        this.disposable.dispose();
    },
    rokuDeployRun: function() {
        atom.notifications.addInfo('Deployment started.');
        this.rokuIpAddress      = atom.config.get('roku-atom.rokuIpAddress');
        this.rokuDevUsername    = atom.config.get('roku-atom.rokuDevUsername');
        this.rokuDevPassword    = atom.config.get('roku-atom.rokuDevPassword');
        this.excludedPaths      = atom.config.get('roku-atom.excludedPaths');
        this.outputDirectory    = atom.config.get('roku-atom.outputDirectory');
        this.skinName           = atom.config.get('roku-atom.skinName');
        this.envName            = atom.config.get('roku-atom.envName');

        projectPath = this.getProjectPath();

        if (!projectPath) {
            atom.notifications.addError("Failed to get project path. Check that your current project is the root of the Roku application and it contains a manifest file.");
            return;
        }

        this.checkBoxExists(projectPath);
    },
    checkBoxExists: function(projectPath) {
        var self = this;

        request.post('http://' + this.rokuIpAddress + ':8060/keypress/Home')
            .on('response', function(response) {
                if (response) {
                    if (response.statusCode !== null && response.statusCode === 200) {
                        if (self.skinName !== "" && self.envName !== "") {
                            var path = projectPath + "/skins/" + self.skinName;

                            try {
                                if (fs.existsSync(path + "/build.json")) {
                                    var buildJson = require(path + "/build.json");
                                    self.applySubstitutions(projectPath, buildJson["substitutionList"]);
                                } else {
                                    atom.notifications.addError("Failed to find build.json file. Is your skin folder set properly?");
                                    return;
                                }
                            } catch (ex) {
                                atom.notifications.addError("Failed to load build.json: " + ex)
                                return;
                            }
                        }

                        self.zipPackage(projectPath);
                    } else {
                        atom.notifications.addError("Failed to send Home command to Roku device!");

                        atom.notifications.addError(response.body);
                    }
                } else {
                    atom.notifications.addError("An error occured. The request returned an empty response.\nPlease check the Roku device's IP address and try again");
                }
            });
    },
	applySubstitutions: function (projectPath, substitutionList) {
		this.filesCache = {};

		for (var i = 0; i < substitutionList.length; i++) {
			var substitution = substitutionList[i];

			if (substitution["activeProfiles"].split(',').indexOf(this.envName) === -1)
				continue;

			for (var j = 0; j < substitution["fileList"].length; j++) {
				var file = projectPath + "/" + substitution["fileList"][j];
				var contents = fs.readFileSync(file, "utf8");

				this.filesCache[file] = contents; // save original contents to memory

				for (var key in substitution["values"]) {
					contents = contents.replace("[" + key + "]", substitution["values"][key]);
				}

				fs.writeFileSync(file, contents);
			}
		}
	},
    zipPackage: function(projectPath) {
        var projectDir = new Directory(projectPath);

        if (projectDir) {
            var projectName = projectDir.getBaseName();
            var projectRealPath = projectDir.getRealPathSync();

            if (projectRealPath == null){
                atom.notifications.addError("Failed to get full project directory path.");
                this.restoreFiles();
                return;
            }

            var pathToZip = projectRealPath + "/" + this.outputDirectory + "/";
            atom.notifications.addInfo("Zipping project into " + pathToZip);
            var stat;

            try {
                stat = fs.lstatSync(pathToZip);
            } catch (_error) {
                // Out dir is not found
                fs.mkdirSync(pathToZip);
                stat = fs.lstatSync(pathToZip);

                if (!stat.isDirectory()) {
                    atom.notifications.addFatalError("Can't create output directory!\nPlease check folder permissions and try again.");
                    this.restoreFiles();
                    return;
                }
            }

            var zipFile = fs.createWriteStream(pathToZip + projectName + ".zip");
            var archiver = Archiver('zip');
            var self = this;

            zipFile.on('close', function () {
                self.restoreFiles();
                self.postZipToBox(projectDir, projectName);
            });

            archiver.on('error', function(err) {
                this.restoreFiles();
                throw err;
            });

            archiver.pipe(zipFile);

            // add manifest file
            archiver.file(projectRealPath + "/" + "manifest", {name: "manifest"});

            // get all root-level folders
            var splitExcludedPaths = this.excludedPaths.toLocaleLowerCase().split(',');
            var entries = projectDir.getEntriesSync();

            // add all non-excluded directories
            for (var j = 0; j < entries.length; j++) {
                var entry = entries[j];

                if (entry.isDirectory() && !entry.getBaseName().startsWith('.')){
                    var isDirNotExcluded = splitExcludedPaths.indexOf(entry.getBaseName().toLocaleLowerCase()) === -1;

                    if (isDirNotExcluded) {
                        archiver.directory(entry.getRealPathSync(), entry.getBaseName());
                    }
                }
            }

            archiver.finalize();
        } else {
            atom.notifications.addError("Failed to get directory information of " + projectPath);
        }
    },
    postZipToBox: function(projectDir, projectName) {
		var self = this;

        atom.notifications.addInfo("Zipping completed. Starting deploy to " + this.rokuIpAddress);

        var installUrl = 'http://' + this.rokuIpAddress + '/plugin_install';
        var directProjectPath = projectDir.getRealPathSync();
        var pathToZip = directProjectPath + "/" + this.outputDirectory + "/";

        var params = {
            auth: {
                user: self.rokuDevUsername,
                pass: self.rokuDevPassword,
                sendImmediately: false
            },
            formData: {
                mysubmit: 'Replace', // not install to know if same code is installed
                archive: fs.createReadStream(pathToZip + projectName + '.zip')
            }
        };

        request.post(installUrl, params, function(error, response, body) {
			self.deployCallback(error, response, body);
		});
    },
    deployCallback: function(error, response, body) {
        if (response && response.statusCode === 200) {
            if (response.body.indexOf("Identical to previous version -- not replacing.") !== -1)
                atom.notifications.addWarning("Package is identical to previous version");
            else
                atom.notifications.addSuccess("Deployed to " + this.rokuIpAddress);
        } else {
            atom.notifications.addError("Failed to deploy to " + this.rokuIpAddress + ". \nCheck IP address, username and password in settings.");

            if (error)
                atom.notifications.addError("Error: " + error);
        }
    },
    restoreFiles: function() {
        for (var file in this.filesCache) {
            fs.writeFileSync(file, this.filesCache[file]);
        }
    },
    getProjectPath: function() {
        // get currently opened project directory
        dir = atom.project.getDirectories()[0];

        if (dir != undefined) {
            pathList = fs.readdirSync(dir.path);

			if (pathList.indexOf("manifest") !== -1) {
				return dir.path;
			} else {
				atom.notifications.addError("No manifest found at project root!");
			}
		}

		return null;
    }
};
