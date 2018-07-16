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
    separator:              null,

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
        }
    },

    activate: function(state) {
        this.rokuIpAddress      = atom.config.get('roku-atom.rokuIpAddress');
        this.rokuDevUsername    = atom.config.get('roku-atom.rokuDevUsername');
        this.rokuDevPassword    = atom.config.get('roku-atom.rokuDevPassword');
        this.excludedPaths      = atom.config.get('roku-atom.excludedPaths');
        this.outputDirectory    = atom.config.get('roku-atom.outputDirectory');
        this.disposable         = new CompositeDisposable;

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

        projectPath = this.getProjectPath();

        if (!projectPath) {
            atom.notifications.addError("Failed to get project path. Check that your current project is the root of the Roku application and it contains a manifest file.");
            return;
        }

        this.checkBoxExists(projectPath);
    },

    // Make Home press request to know that box exist
    checkBoxExists: function(projectPath) {
        var self = this;
        request.post('http://' + this.rokuIpAddress + ':8060/keypress/Home')
            .on('response', function(response) {
                if (response) {
                    if (response.statusCode !== null && response.statusCode === 200) {
                        self.zipPackage(projectPath);
                    } else {
                        atom.notifications.addError("Failed to send Home command to Roku device!");

                        atom.notifications.addError(response.body);
                    }
                } else {
                    atom.notifications.addError("An error occured. The request returned an empty response.\nPlease check the Roku device's IP address and try againé");
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

            var zipFile = fs.createWriteStream(pathToZip + projectName + ".zip");
            var archiver = Archiver('zip');
            var self = this;

            zipFile.on('close', function () {
                self.postZipToBox(projectDir, projectName);
            });

            archiver.on('error', function(err) {
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
                user: "rokudev",
                pass: "1234",
                sendImmediately: false
            },
            formData: {
                mysubmit: 'Replace', // not install to know if same code is installed
                archive: fs.createReadStream(pathToZip + projectName + '.zip')
            }
        };

        request.post(installUrl, params, function(error, response, body) {
			self.deployCallback(error, response, body)
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

