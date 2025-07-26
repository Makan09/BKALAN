#!/usr/bin/env python3
"""
BKalan Educational Platform Backend API Tests
Tests all FastAPI endpoints and WebSocket functionality
"""

import requests
import json
import sys
import os
import tempfile
from datetime import datetime
import websocket
import threading
import time

class BKalanAPITester:
    def __init__(self, base_url="https://f0818242-66de-42f5-979d-2026288942ec.preview.emergentagent.com"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.uploaded_file_id = None
        self.ws_messages = []
        self.ws_connected = False

    def log_test(self, name, success, details=""):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED {details}")
        else:
            print(f"❌ {name} - FAILED {details}")
        return success

    def test_health_check(self):
        """Test basic health endpoint"""
        try:
            response = requests.get(f"{self.base_url}/api/health", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            return self.log_test(
                "Health Check", 
                success, 
                f"Status: {response.status_code}, Response: {data}"
            )
        except Exception as e:
            return self.log_test("Health Check", False, f"Error: {str(e)}")

    def test_get_sections(self):
        """Test sections endpoint"""
        try:
            response = requests.get(f"{self.base_url}/api/sections", timeout=10)
            success = response.status_code == 200
            
            if success:
                data = response.json()
                expected_sections = ['lycee_generale', 'lycee_technique', 'fondamentale']
                has_all_sections = all(section in data for section in expected_sections)
                
                # Check specific content
                lycee_generale_classes = data.get('lycee_generale', [])
                lycee_technique_classes = data.get('lycee_technique', [])
                fondamentale_classes = data.get('fondamentale', [])
                
                success = has_all_sections and len(lycee_generale_classes) > 0
                details = f"Sections: {list(data.keys())}, Lycée Générale classes: {len(lycee_generale_classes)}"
            else:
                details = f"Status: {response.status_code}"
                
            return self.log_test("Get Sections", success, details)
        except Exception as e:
            return self.log_test("Get Sections", False, f"Error: {str(e)}")

    def test_file_upload(self):
        """Test file upload functionality"""
        try:
            # Create a temporary test file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as temp_file:
                temp_file.write("Test document content for BKalan platform")
                temp_file_path = temp_file.name

            # Prepare upload data
            files = {'file': ('test_document.txt', open(temp_file_path, 'rb'), 'text/plain')}
            data = {
                'title': 'Test Document',
                'section': 'lycee_generale',
                'subcategory': '10ème',
                'description': 'Test document for API testing'
            }

            response = requests.post(f"{self.base_url}/api/upload", files=files, data=data, timeout=30)
            
            # Clean up
            files['file'][1].close()
            os.unlink(temp_file_path)
            
            success = response.status_code == 200
            if success:
                result = response.json()
                self.uploaded_file_id = result.get('file_id')
                details = f"File ID: {self.uploaded_file_id}, Filename: {result.get('filename')}"
            else:
                details = f"Status: {response.status_code}, Response: {response.text[:200]}"
                
            return self.log_test("File Upload", success, details)
        except Exception as e:
            return self.log_test("File Upload", False, f"Error: {str(e)}")

    def test_get_documents(self):
        """Test documents retrieval"""
        try:
            # Test getting all documents
            response = requests.get(f"{self.base_url}/api/documents", timeout=10)
            success = response.status_code == 200
            
            if success:
                documents = response.json()
                details = f"Total documents: {len(documents)}"
                
                # Test filtered documents
                filtered_response = requests.get(
                    f"{self.base_url}/api/documents?section=lycee_generale&subcategory=10ème", 
                    timeout=10
                )
                if filtered_response.status_code == 200:
                    filtered_docs = filtered_response.json()
                    details += f", Filtered documents: {len(filtered_docs)}"
            else:
                details = f"Status: {response.status_code}"
                
            return self.log_test("Get Documents", success, details)
        except Exception as e:
            return self.log_test("Get Documents", False, f"Error: {str(e)}")

    def test_get_document_by_id(self):
        """Test individual document retrieval"""
        if not self.uploaded_file_id:
            return self.log_test("Get Document by ID", False, "No uploaded file ID available")
            
        try:
            response = requests.get(f"{self.base_url}/api/documents/{self.uploaded_file_id}", timeout=10)
            success = response.status_code == 200
            
            if success:
                # Check if it's a file download response
                content_type = response.headers.get('content-type', '')
                content_length = len(response.content)
                details = f"Content-Type: {content_type}, Size: {content_length} bytes"
            else:
                details = f"Status: {response.status_code}"
                
            return self.log_test("Get Document by ID", success, details)
        except Exception as e:
            return self.log_test("Get Document by ID", False, f"Error: {str(e)}")

    def test_chat_messages(self):
        """Test chat messages endpoint"""
        try:
            response = requests.get(f"{self.base_url}/api/chat/messages", timeout=10)
            success = response.status_code == 200
            
            if success:
                messages = response.json()
                details = f"Messages count: {len(messages)}"
            else:
                details = f"Status: {response.status_code}"
                
            return self.log_test("Get Chat Messages", success, details)
        except Exception as e:
            return self.log_test("Get Chat Messages", False, f"Error: {str(e)}")

    def test_websocket_connection(self):
        """Test WebSocket chat functionality"""
        try:
            # Convert HTTP URL to WebSocket URL
            ws_url = self.base_url.replace('https://', 'wss://').replace('http://', 'ws://')
            ws_url = f"{ws_url}/api/chat/ws/TestUser"
            
            def on_message(ws, message):
                self.ws_messages.append(json.loads(message))
                print(f"WebSocket received: {message}")

            def on_open(ws):
                self.ws_connected = True
                print("WebSocket connection opened")
                # Send a test message
                test_message = {"message": "Hello from API test!"}
                ws.send(json.dumps(test_message))

            def on_error(ws, error):
                print(f"WebSocket error: {error}")

            def on_close(ws, close_status_code, close_msg):
                print("WebSocket connection closed")

            # Create WebSocket connection
            ws = websocket.WebSocketApp(
                ws_url,
                on_open=on_open,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close
            )

            # Run WebSocket in a separate thread
            ws_thread = threading.Thread(target=ws.run_forever)
            ws_thread.daemon = True
            ws_thread.start()

            # Wait for connection and message exchange
            time.sleep(3)
            
            # Close connection
            ws.close()
            
            success = self.ws_connected and len(self.ws_messages) > 0
            details = f"Connected: {self.ws_connected}, Messages received: {len(self.ws_messages)}"
            
            return self.log_test("WebSocket Connection", success, details)
        except Exception as e:
            return self.log_test("WebSocket Connection", False, f"Error: {str(e)}")

    def run_all_tests(self):
        """Run all API tests"""
        print("🚀 Starting BKalan API Tests")
        print(f"Testing against: {self.base_url}")
        print("=" * 60)

        # Run tests in order
        self.test_health_check()
        self.test_get_sections()
        self.test_file_upload()
        self.test_get_documents()
        self.test_get_document_by_id()
        self.test_chat_messages()
        self.test_websocket_connection()

        # Print summary
        print("=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} tests passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All tests passed!")
            return 0
        else:
            print("⚠️  Some tests failed!")
            return 1

def main():
    """Main test runner"""
    tester = BKalanAPITester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())