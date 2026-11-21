"""urllib_post against a server on localhost: never a provider."""

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from django.test import SimpleTestCase

from messaging.senders.http import urllib_post


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        received = self.rfile.read(int(self.headers["Content-Length"]))
        status = 429 if self.path == "/limit" else 200
        self.send_response(status)
        self.end_headers()
        self.wfile.write(received.upper())

    def log_message(self, *args):
        pass


class UrllibPostTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.server = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        super().tearDownClass()

    def test_returns_the_answer(self):
        response = urllib_post(f"{self.base}/send", {}, b"hello", 5)

        self.assertEqual((response.status, response.body), (200, b"HELLO"))

    def test_an_error_status_is_an_answer_not_an_exception(self):
        response = urllib_post(f"{self.base}/limit", {}, b"hello", 5)

        self.assertEqual((response.status, response.body), (429, b"HELLO"))

    def test_no_server_raises(self):
        port = self.server.server_port
        self.server.shutdown()
        self.server.server_close()
        try:
            with self.assertRaises(OSError):
                urllib_post(f"http://127.0.0.1:{port}/send", {}, b"hello", 5)
        finally:
            type(self).server = HTTPServer(("127.0.0.1", 0), Handler)
            threading.Thread(target=self.server.serve_forever, daemon=True).start()
            type(self).base = f"http://127.0.0.1:{self.server.server_port}"
