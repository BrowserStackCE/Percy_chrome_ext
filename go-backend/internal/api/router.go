package api

import (
	"net/http"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/api/handlers"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/middleware"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/app"
)

type Server struct {
	addr string 
	mux *http.ServeMux

	app *app.App
}

func NewServer ( addr string , app *app.App) *Server {
	s:= &Server{
		addr: addr,
		mux: http.NewServeMux(),
		app: app,
	}

	s.routes()

	return s
}

func (s *Server) routes() {
	snapshotHandler := handlers.NewSnapshotHandler(s.app)
	buildHandler := handlers.NewBuildHandler(s.app)
	libraryHandler := handlers.NewLibraryHandler(s.app)

	s.mux.HandleFunc("/health" , handlers.Health)
	s.mux.HandleFunc("/status" , handlers.Status)

	s.mux.HandleFunc("/snapshots" ,func(w http.ResponseWriter ,r *http.Request) {

		switch r.Method {
		case http.MethodPost :
			snapshotHandler.Create(w,r) 
			
		case http.MethodGet :
			snapshotHandler.List(w,r)

		case http.MethodDelete :
			snapshotHandler.Clear(w,r)

		default :
			http.Error(w, "Method Not Allowed" ,http.StatusMethodNotAllowed)
		}
	})

	s.mux.HandleFunc("/snapshots/", func(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPatch:
		snapshotHandler.Update(w, r)

	case http.MethodDelete:
		snapshotHandler.Delete(w, r)

	default:
		http.Error(
			w,
			"Method Not Allowed",
			http.StatusMethodNotAllowed,
		)
	}
})

	s.mux.HandleFunc("/build/finalize", buildHandler.Finalize)
	s.mux.HandleFunc("/build/finalize/stream", buildHandler.FinalizeStream)

	s.mux.HandleFunc("/library/token", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			libraryHandler.GetToken(w, r)
		case http.MethodPost:
			libraryHandler.SetToken(w, r)
		default:
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		}
	})
	s.mux.HandleFunc("/library/search", libraryHandler.Search)		
	s.mux.HandleFunc("/library/status", libraryHandler.Status)
	s.mux.HandleFunc("/library/all", libraryHandler.All)
	
}

func (s *Server) Start() error {
	handler := middleware.Chain(
		s.mux,
		middleware.Recovery,
		middleware.Logger,
		middleware.CORS,
	)
	return http.ListenAndServe(s.addr ,handler)
}

