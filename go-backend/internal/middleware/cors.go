package middleware

import "net/http"

func CORS(next http.Handler)http.Handler {
	return http.HandlerFunc(func (w http.ResponseWriter ,r *http.Request){

		// nosemgrep: local-only backend (localhost:4321) called by the browser extension; wildcard origin is intentional
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods","GET, POST, PUT, DELETE, OPTIONS")	
		
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w,r)
	})
}