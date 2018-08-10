'use strict';

var AdmZip = require('adm-zip');
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

        var projectPath = this.getProjectPath();

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
                        self.zipPackage(projectPath);
                    } else {
                        atom.notifications.addError("Failed to send Home command to Roku device!");
                    }
                } else {
                    atom.notifications.addError("An error occured. The request returned an empty response.\nPlease check the Roku device's IP address and try again");
                }
            });
    },
    zipPackage: function(projectPath) {
        var projectDir = new Directory(projectPath);

        if (projectDir) {
            var projectName = projectDir.getBaseName();
            var projectRealPath = projectDir.getRealPathSync();

            if (projectRealPath == null){
                atom.notifications.addError("Failed to get full project directory path.");
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
                    return;
                }
            }

            var zip = new AdmZip();
            var self = this;

            // add manifest file
            zip.addLocalFile(projectRealPath + "/" + "manifest");

            // get all root-level folders
            var splitExcludedPaths = this.excludedPaths.toLocaleLowerCase().split(',');
            var entries = projectDir.getEntriesSync();

            // add all non-excluded directories
            for (var j = 0; j < entries.length; j++) {
                var entry = entries[j];

                if (entry.isDirectory() && !entry.getBaseName().startsWith('.')){
                    var isDirNotExcluded = splitExcludedPaths.indexOf(entry.getBaseName().toLocaleLowerCase()) === -1;

                    if (isDirNotExcluded) {
                        zip.addLocalFolder(entry.getRealPathSync(), entry.getBaseName());
                    }
                }
            }

            if (self.skinName !== "" && self.envName !== "") {
                var path = projectPath + "/skins/" + self.skinName;

                try {
                    if (fs.existsSync(path + "/build.json")) {
                        var buildJson = JSON.parse(fs.readFileSync(path + "/build.json"));
                        var manifestConfig = buildJson["manifest"];
                        var files = self.applySubstitutions(projectPath, buildJson["substitutionList"]);

                        for (var filePath in files) {
                            zip.updateFile(filePath, new Buffer(files[filePath]));
                        }

                        // generate manifest
                        if (manifestConfig) {
                            var manifest = "";
                            var entries = manifestConfig["base"] || [];

                            for (var entry in manifestConfig[self.envName])
                                entries[entry] = manifestConfig[self.envName][entry];

                            for (var entry in entries)
                                manifest += entry + "=" + entries[entry] + "\n";

                            zip.updateFile("manifest", new Buffer(manifest));
                        } else {
                            atom.notifications.addWarning("Failed to generate manifest from build.json, falling back to file");
                        }

                        var exclude = ["packaging"]

                        var skinFolders = fs.readdirSync(path).filter(item => {
                            var stat = fs.lstatSync(path + "/" + item);
                            return stat.isDirectory() && exclude.indexOf(item) === -1;
                        });

                        for (var i = 0; i < skinFolders.length; i++) {
                            this.updateLocalFolder(zip, path + "/" + skinFolders[i], skinFolders[i]);
                        }
                    } else {
                        atom.notifications.addError("Failed to find build.json file. Is your skin folder set properly?");
                        return;
                    }
                } catch (ex) {
                    atom.notifications.addError("Failed to load build.json: " + ex)
                    return;
                }
            }

            zip.writeZip(pathToZip + projectName + ".zip");

            self.postZipToBox(projectDir, projectName);
        } else {
            atom.notifications.addError("Failed to get directory information of " + projectPath);
        }
    },
    updateLocalFolder: function (zip, localFolder, zipPath) {
        var entries = fs.readdirSync(localFolder);

        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var stat = fs.lstatSync(localFolder + "/" + entry);

            if (stat.isDirectory()) {
                this.updateLocalFolder(zip, localFolder + "/" + entry, zipPath + "/" + entry);
            } else {
                if (zip.getEntry(zipPath + "/" + entry) !== null) {
                    zip.updateFile(zipPath + "/" + entry, fs.readFileSync(localFolder + "/" + entry));
                } else {
                    zip.addFile(zipPath + "/" + entry, fs.readFileSync(localFolder + "/" + entry));
                }
            }
        }
    },
	applySubstitutions: function (projectPath, substitutionList) {
		var files = {};

		for (var i = 0; i < substitutionList.length; i++) {
			var substitution = substitutionList[i];

			if (substitution["activeProfiles"].split(',').indexOf(this.envName) === -1)
				continue;

			for (var j = 0; j < substitution["fileList"].length; j++) {
				var file = substitution["fileList"][j];
                var contents;

                if (file in files) {
                    contents = files[file];
                } else {
                    contents = fs.readFileSync(projectPath + "/" + file, "utf8");
                }

				for (var key in substitution["values"]) {
					contents = contents.replace("[" + key + "]", substitution["values"][key]);
				}

				files[file] = contents;
			}
		}

        return files;
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
            else if (response.body.indexOf("No manifest.") !== -1)
                atom.notifications.addError("Could not install package: No manifest");
            else
                atom.notifications.addSuccess("Deployed to " + this.rokuIpAddress);
        } else {
            atom.notifications.addError("Failed to deploy to " + this.rokuIpAddress + ". \nCheck IP address, username and password in settings.");

            if (error)
                atom.notifications.addError("Error: " + error);
        }
    },
    getProjectPath: function() {
        // get currently opened project directory
        var dir = atom.project.getDirectories()[0];

        if (dir != undefined) {
            var pathList = fs.readdirSync(dir.path);

			if (pathList.indexOf("manifest") !== -1) {
				return dir.path;
			} else {
				atom.notifications.addError("No manifest found at project root!");
			}
		}

		return null;
    }
};
