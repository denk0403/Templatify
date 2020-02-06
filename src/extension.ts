// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

type File = {
	filename: string;
	content: string;
};

type Directory = {
	directoryName: string;
	source: (File | Directory)[];
};

type Template = {
	templateName: string;
	description?: string;
	author?: string;
	source: (File | Directory)[];
};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log(
		'Templatify is now active!'
	);

	if (!fs.existsSync(path.resolve(__dirname, "../templates"))) {
		fs.mkdirSync(path.resolve(__dirname, "../templates"));
	}

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = [];
	disposable.push(
		vscode.commands.registerCommand("extension.importTemplate", () => {
			// The code you place here will be executed every time your command is executed

			// Display a message box to the user
			if (!vscode.workspace.workspaceFolders) {
				vscode.window.showInformationMessage("You must be working from inside a folder to import a template.");
				return;
			}

			// Extension configuration
			const configs = vscode.workspace.getConfiguration("templatify");

			// the default location for templates is within the extension project directory.
			const defaultTemplateLocation = path.resolve(__dirname, "../templates");
			const templateLocation = configs.get("templateLocation") as string || defaultTemplateLocation;

			// retrieves contents of template directory
			fs.readdir(templateLocation, { withFileTypes: true }, async (err, files) => {
				if (err) {
					vscode.window.showErrorMessage(
						"Unable to locate template directory. Make sure your template path is pointing to the correct directory."
					);
				} else {
					try {
						let templates = await getJSONTemplates(templateLocation, files);

						if (!templates.length) {
							vscode.window.showInformationMessage("Templatify did not find any templates in the templates directory.");
							return;
						}

						let templateNames = templates.map(
							(template, index) => `${index + 1}. ${template.templateName}`
						);

						let templateChoiceName = await vscode.window.showQuickPick(
							templateNames,
							{
								placeHolder: "Import a template",
								onDidSelectItem: (item) => {
									let str = item as string;
									let message = templates[parseInt(str.slice(0, str.indexOf("."))) - 1].description;
									if (message) {
										vscode.window.showInformationMessage(message);
									}
								}
							}
						);

						let templateChoiceIndex;
						if (templateChoiceName) {
							templateChoiceIndex = parseInt(templateChoiceName.slice(0, templateChoiceName.indexOf("."))) - 1;
						} else {
							return;
						}

						// imports selected template into current project
						if (templateChoiceIndex >= 0) {
							let template = templates[templateChoiceIndex];
							vscode.window.showInformationMessage(`Imported template: ${templates[templateChoiceIndex].templateName}`);
							await extractTemplateSource(template);
						} else {
							throw Error();
						}
					}
					catch (error) {
						vscode.window.showErrorMessage("There was an unexpected error. Try restarting Visual Studio Code.");
						return;
					}
				}
			});
		}),
		vscode.commands.registerCommand("extension.exportTemplate", async () => {

			// Display a message box to the user
			if (!vscode.workspace.workspaceFolders) {
				vscode.window.showInformationMessage("You must be working from inside a folder to export as template.");
				return;
			}

			// Extension configuration
			const configs = vscode.workspace.getConfiguration("templatify");

			// the default location for templates is within the extension project directory.
			const defaultTemplateLocation = path.resolve(__dirname, "../templates");
			const templateLocation = configs.get("templateLocation") as string || defaultTemplateLocation;

			let templateFiles: string[] = fs.readdirSync(templateLocation);
			let projectName = vscode.workspace.workspaceFolders[0].name;

			// Get unique template name
			let successfulName = false;
			let newTemplateName: string | undefined = undefined;
			while (!successfulName) {
				newTemplateName = await vscode.window.showInputBox({ prompt: "Give this new template a unique name", value: projectName, placeHolder: "Unique template name" }) as string;
				let encodedName = encodeName(newTemplateName);
				if (templateFiles.every(file => file !== encodedName)) {
					successfulName = true;
				} else {
					vscode.window.showInformationMessage("There already exists a template with a similar name. Please name your template differently.");
				}
			}
			if (newTemplateName === undefined) { return; }

			// Terminate command if no template name is specified
			if (!newTemplateName.trim()) {
				vscode.window.showInformationMessage("Must specify non-empty template name.");
				return;
			}

			// Allow user to specify template description and/or author
			let newTemplateDescription = await vscode.window.showInputBox({ prompt: "Give this new template a description", placeHolder: "Template description" });
			if (newTemplateDescription === undefined) { return; }
			newTemplateDescription = newTemplateDescription.trim();

			let newTemplateAuthor = await vscode.window.showInputBox({ prompt: "Give this template its author(s)", placeHolder: "Template author(s)" });
			if (newTemplateAuthor === undefined) { return; }
			newTemplateAuthor = newTemplateAuthor.trim();

			let templateJSON: Template = { templateName: newTemplateName, source: [] };
			newTemplateAuthor && (templateJSON.author = newTemplateAuthor);
			newTemplateDescription && (templateJSON.description = newTemplateDescription);

			fs.readdir(vscode.workspace.rootPath as string, { withFileTypes: true }, async (err, files) => {
				if (err) {
					vscode.window.showErrorMessage("There was an unexpected error. Try restarting Visual Studio Code.");
					return;
				} else {
					try {
						await addSourceToTemplate(files, templateJSON);
						fs.writeFileSync(path.resolve(templateLocation, encodeName(newTemplateName) as string), JSON.stringify(templateJSON));
						vscode.window.showInformationMessage("Successfully exported project as template!");
					} catch {
						vscode.window.showErrorMessage("There was an unexpected error. Try restarting Visual Studio Code.");
						return;
					}
				}
			});

		}),
		vscode.commands.registerCommand("extension.removeTemplate", () => {

			// Extension configuration
			const configs = vscode.workspace.getConfiguration("templatify");

			// the default location for templates is within the extension project directory.
			const defaultTemplateLocation = path.resolve(__dirname, "../templates");
			const templateLocation = configs.get("templateLocation") as string || defaultTemplateLocation;

			fs.readdir(templateLocation, { withFileTypes: true }, async (err, files) => {
				if (err) {
					vscode.window.showErrorMessage(
						"Unable to locate template directory. Make sure your template path is pointing to the correct directory."
					);
				} else {
					try {
						let templates = await getJSONTemplates(templateLocation, files);

						if (!templates.length) {
							vscode.window.showInformationMessage("Templatify did not find any templates in the templates directory.");
							return;
						}

						let templateNames = templates.map(
							(template, index) => `${index + 1}. ${template.templateName}`
						);

						let templateChoiceNames = await vscode.window.showQuickPick(
							templateNames,
							{
								placeHolder: "Choose a template to remove",
								canPickMany: true,
								onDidSelectItem: (item) => {
									let str = item as string;
									let message = templates[parseInt(str.slice(0, str.indexOf("."))) - 1].description;
									if (message) {
										vscode.window.showInformationMessage(message);
									}
								}
							}
						);

						let templateChoiceIndices;
						if (templateChoiceNames) {
							templateChoiceIndices = templateChoiceNames.map(name => parseInt(name.slice(0, name.indexOf("."))) - 1);
						} else {
							return;
						}

						// removes selected templates from template directory
						templateChoiceIndices.forEach(index => {
							fs.unlinkSync(path.resolve(templateLocation, encodeName(templates[index].templateName) as string));
							vscode.window.showInformationMessage("Successfully removed template!");
						});

					} catch {
						vscode.window.showErrorMessage("There was an unexpected error. Try restarting Visual Studio Code.");
						return;
					}
				}
			});

		}),
		vscode.commands.registerCommand("extension.updateTemplate", () => {

			// Display a message box to the user
			if (!vscode.workspace.workspaceFolders) {
				vscode.window.showInformationMessage("You must be working from inside a folder to import a template.");
				return;
			}

			// Extension configuration
			const configs = vscode.workspace.getConfiguration("templatify");

			// the default location for templates is within the extension project directory.
			const defaultTemplateLocation = path.resolve(__dirname, "../templates");
			const templateLocation = configs.get("templateLocation") as string || defaultTemplateLocation;

			// retrieves contents of template directory
			fs.readdir(templateLocation, { withFileTypes: true }, async (err, files) => {
				if (err) {
					vscode.window.showErrorMessage(
						"Unable to locate template directory. Make sure your template path is pointing to the correct directory."
					);
				} else {
					try {
						let templates = await getJSONTemplates(templateLocation, files);

						if (!templates.length) {
							vscode.window.showInformationMessage("Templatify did not find any templates in the templates directory.");
							return;
						}

						let templateNames = templates.map(
							(template, index) => `${index + 1}. ${template.templateName}`
						);

						let templateChoiceName = await vscode.window.showQuickPick(
							templateNames,
							{
								placeHolder: "Select a template to update",
								onDidSelectItem: (item) => {
									let str = item as string;
									let message = templates[parseInt(str.slice(0, str.indexOf("."))) - 1].description;
									if (message) {
										vscode.window.showInformationMessage(message);
									}
								}
							}
						);

						let templateChoiceIndex: number;
						if (templateChoiceName) {
							templateChoiceIndex = parseInt(templateChoiceName.slice(0, templateChoiceName.indexOf("."))) - 1;
						} else {
							return;
						}

						// imports selected template into current project
						if (templateChoiceIndex >= 0) {
							let templateJSON = templates[templateChoiceIndex];

							fs.readdir(vscode.workspace.rootPath as string, { withFileTypes: true }, async (err, files) => {
								if (err) {
									vscode.window.showErrorMessage("There was an unexpected error. Try restarting Visual Studio Code.");
									return;
								} else {
									try {
										templateJSON.source = [];
										await addSourceToTemplate(files, templateJSON);
										fs.writeFileSync(path.resolve(templateLocation, encodeName(templateJSON.templateName) as string), JSON.stringify(templateJSON));
										vscode.window.showInformationMessage(`Updated template: ${templates[templateChoiceIndex].templateName}`);
									} catch {
										vscode.window.showErrorMessage("There was an unexpected error. Try restarting Visual Studio Code.");
										return;
									}
								}
							});

						} else {
							throw Error();
						}
					}
					catch (error) {
						vscode.window.showErrorMessage("There was an unexpected error. Try restarting Visual Studio Code.");
						return;
					}
				}
			});
		})
	);

	context.subscriptions.push(...disposable);
}

const codingKey = 13;
/**
 * Encodes a string using a caeser cipher. Used to generate 
 * @param str The string to encode
 */
function encodeName(str: string | undefined): string | undefined {
	if (str) {
		return `${str.toLowerCase().replace(/[a-z]/g, c => String.fromCharCode((c.charCodeAt(0) - 97 + codingKey) % 26 + 97)).replace(/\s+/g, "")}.template.json`;
	}
	return undefined;
}

/**
 * Parses files and adds contents to template source.
 * @param files Array of fs.Dirents of templated project
 * @param template A reference to the final template JSON that will be outputed
 */
async function addSourceToTemplate(files: fs.Dirent[], template: Template): Promise<void[]> {
	return addContentsToSource(files, vscode.workspace.rootPath as string, template.source);
}

/**
 * Add a folder's contents to the given source.
 * @param files The content files to add to the given source
 * @param dirPath The path to the given files
 * @param source The source to save the content files to
 */
async function addContentsToSource(files: fs.Dirent[], dirPath: string, source: (File | Directory)[]) {
	let promises: Promise<void>[] = [];
	files.forEach(file => {
		if (file.isFile()) {
			promises.push(addFileToSource(file, dirPath, source));
		} else if (file.isDirectory()) {
			promises.push(addDirectoryToSource(file, dirPath, source));
		}
	});
	return Promise.all(promises);
}

/**
 * Adds a specified file to the given source of a template.
 * @param file The file from the specified directory
 * @param dirPath The directory to look for the file in
 * @param source The source to add the file to
 */
async function addFileToSource(file: fs.Dirent, dirPath: string, source: (File | Directory)[]): Promise<void> {
	return new Promise((resolve, reject) => {
		fs.readFile(path.resolve(dirPath, file.name), (err, data) => {
			if (err) {
				reject();
				return;
			} else {
				source.push({
					filename: file.name,
					content: escape(data.toString())
				});
				resolve();
			}
		});
	});
}

/**
 * Adds a specified directory to the given source of a template.
 * @param dir The inner directory from the specified directory
 * @param dirPath The directory to look for the inner directory in
 * @param source The source to add the directory to
 */
async function addDirectoryToSource(dir: fs.Dirent, dirPath: string, source: (File | Directory)[]): Promise<void> {
	return new Promise((resolve, reject) => {
		let newDirectory = {
			directoryName: dir.name,
			source: []
		};
		let { source: innerSource } = newDirectory;
		fs.readdir(path.resolve(dirPath, dir.name), { withFileTypes: true }, async (err, files) => {
			if (err) {
				reject();
				return;
			} else {
				await addContentsToSource(files, path.resolve(dirPath, dir.name), innerSource);
				source.push(newDirectory);
				resolve();
			}
		});
	});
}

/**
 *  Asynchronously retrieves all valid templates from the specified template directory.
 *  */
async function getJSONTemplates(templateLocation: string, files: fs.Dirent[]): Promise<Template[]> {
	let promises: Promise<Template>[] = [];
	files.forEach(file => {
		if (file.isFile() && file.name.match(/\.template\.json$/)) { // template files are .template.json files
			promises.push(new Promise((resolve, reject) => {
				fs.readFile(path.resolve(templateLocation, file.name), (err, data) => {
					if (err) {
						reject();
					} else {
						try {
							let output: Template = JSON.parse(data.toString());
							if (isJSONTemplate(output)) {
								resolve(output); // resolve template if valid and well-formed
							} else {
								throw Error("Template isn't well-formed");
							}
						} catch {
							let action = vscode.window.showErrorMessage(`A template file (${file.name}) may be corrupted.`, "See File");
							action.then(value => {
								if (value) {
									vscode.workspace.openTextDocument(path.resolve(templateLocation, file.name)).then(document => {
										vscode.window.showTextDocument(document);
									});
								}
							}); // notify user of possibly corrupted template and let them choose to open it.
							resolve(undefined); // don't interupt promises but return dummy value
						}
					}
				}
				);
			}));
		}
	});
	return (await Promise.all(promises)).filter(template => template !== undefined); // filter out dummy values
}

/**
 * Extracts the contents of the template into the current working directory.
 * @param template A valid template
 */
async function extractTemplateSource(template: Template): Promise<void> {
	extractSource(vscode.workspace.rootPath as string, template.source);
}

/**
 * Extracts the given content into the specified directory.
 * @param currentDir A valid local directory
 * @param content An array of Files and Directories
 */
function extractSource(currentDir: string, content: (File | Directory)[]): void {
	content.forEach(async item => {
		let itemDir = item as Directory;
		let itemFile = item as File;
		if (itemDir.directoryName) {
			createDirectory(currentDir, itemDir);
		} else if (itemFile.filename) {
			createFile(currentDir, itemFile);
		}
	});
}

/**
 * Creates a new directory in the specified current directory.
 * @param currentDir A valid local directory
 * @param itemDir The Directory to create
 */
async function createDirectory(currentDir: string, itemDir: Directory) {
	let newDirectoryRoot = path.resolve(currentDir, itemDir.directoryName);
	let newDirectory = newDirectoryRoot;
	let successful = false;
	let count = 0;

	while (!successful) {
		await new Promise((resolve) => {
			fs.exists(newDirectory, (exists) => {
				if (exists) {
					newDirectory = `${newDirectoryRoot} (${++count})`;
					resolve();
				} else {
					fs.mkdir(newDirectory, () => {
						extractSource(newDirectory, itemDir.source);
					});
					successful = true;
					resolve();
				}
			});
		});
	}
}

/**
 * Creates a new file in the specified current directory.
 * @param currentDir A valid local directory
 * @param itemFile The File to create
 */
async function createFile(currentDir: string, itemFile: File) {
	let newFileRoot = "";
	let extension = "";
	let dotLocation = itemFile.filename.lastIndexOf(".");

	if (dotLocation === -1) {
		newFileRoot = path.resolve(currentDir, itemFile.filename);
	} else {
		newFileRoot = path.resolve(currentDir, itemFile.filename.slice(0, dotLocation));
		extension = itemFile.filename.slice(dotLocation);
	}

	let newFile = `${newFileRoot}${extension}`;
	let successful = false;
	let count = 0;
	while (!successful) {
		await new Promise((resolve) => {
			fs.exists(newFile, (exists) => {
				if (exists) {
					newFile = `${newFileRoot} (${++count})${extension}`;
					resolve();
				} else {
					fs.writeFile(newFile, unescape(itemFile.content), () => { });
					successful = true;
					resolve();
				}
			});
		});
	}
}

/**
 * Checks that the given template is a valid Template.
 * @param template The Template to verify
 */
function isJSONTemplate(template: Template): boolean {
	return typeof template.templateName === 'string'
		&& Array.isArray(template.source) && ensureValidSource(template.source);
}

/**
 * Checks that the given source is made up of valid Files and Directories.
 * @param source The template source to verify
 */
function ensureValidSource(source: (File | Directory)[]): boolean {
	return source.every(item => {
		let itemDir = item as Directory;
		let itemFile = item as File;
		if (typeof itemDir.directoryName === 'string') {
			return ensureValidSource(itemDir.source);
		} else if (itemFile.filename) {
			return typeof itemFile.content === 'string';
		} else {
			return false;
		}
	});
}

// this method is called when your extension is deactivated
export function deactivate() { }
