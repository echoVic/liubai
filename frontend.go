package main

import (
	"io/fs"
	"os"
	"path/filepath"

	"github.com/egoist/mygo"
)

// frontendFiles returns the built frontend. It ships once in the app's
// resources (Contents/Resources/web) rather than embedded in each architecture
// of a universal executable, which doubled the installer's largest files.
// Unpackaged runs, such as development servers and the browser checks, read
// the project's web directory, as they start in the project.
func frontendFiles() fs.FS {
	if mygo.App.IsPackaged() {
		if resources, err := mygo.App.Path(mygo.PathResources); err == nil {
			return os.DirFS(filepath.Join(resources, "web"))
		}
	}
	return os.DirFS("web")
}
