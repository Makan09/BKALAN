from fastapi import FastAPI, File, UploadFile, HTTPException, WebSocket, WebSocketDisconnect, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import os
import uuid
import shutil
from datetime import datetime
from typing import List, Dict, Any
import json
from pymongo import MongoClient
from pydantic import BaseModel

# MongoDB setup
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017/')
client = MongoClient(MONGO_URL)
db = client.bkalan_db

# Collections
documents_collection = db.documents
messages_collection = db.messages

app = FastAPI()

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create uploads directory if it doesn't exist
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Mount static files
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# WebSocket connection manager for real-time chat
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.users: Dict[WebSocket, str] = {}

    async def connect(self, websocket: WebSocket, user_name: str):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.users[websocket] = user_name
        
        # Notify others about new user
        await self.broadcast({
            "type": "user_joined",
            "user": user_name,
            "timestamp": datetime.now().isoformat()
        })

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            user_name = self.users.pop(websocket, "Anonymous")
            return user_name
        return None

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except:
                pass

manager = ConnectionManager()

# Pydantic models
class ChatMessage(BaseModel):
    user: str
    message: str
    timestamp: str

class DocumentInfo(BaseModel):
    title: str
    section: str
    subcategory: str
    description: str = ""

# API Routes
@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/api/sections")
async def get_sections():
    return {
        "lycee_generale": [
            "10ème",
            "11ème Sciences",
            "11ème SES",
            "TSE",
            "TSEXP",
            "TSS",
            "TSECO",
            "TLL"
        ],
        "lycee_technique": [
            "10ème Commune",
            "11ème GM",
            "11ème GC",
            "11ème GMI",
            "11ème GELN",
            "11ème GEN",
            "11ème GEL",
            "11ème CF",
            "11ème GCO",
            "12ème GM",
            "12ème GC",
            "12ème GMI",
            "12ème GELN",
            "12ème GEN",
            "12ème GEL",
            "12ème CF"
        ],
        "fondamentale": [
            "7ème année",
            "8ème année",
            "9ème année"
        ]
    }

@app.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...),
    title: str = "",
    section: str = "",
    subcategory: str = "",
    description: str = ""
):
    try:
        print(f"Debug: Upload parameters - title: {title}, section: {section}, subcategory: {subcategory}")
        
        # Generate unique filename
        file_id = str(uuid.uuid4())
        file_extension = os.path.splitext(file.filename)[1]
        filename = f"{file_id}{file_extension}"
        file_path = os.path.join(UPLOAD_DIR, filename)
        
        # Save file
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Save document info to database
        document_data = {
            "id": file_id,
            "title": title or file.filename,
            "filename": filename,
            "original_filename": file.filename,
            "section": section,
            "subcategory": subcategory,
            "description": description,
            "file_type": file.content_type,
            "upload_date": datetime.now().isoformat(),
            "file_size": os.path.getsize(file_path)
        }
        
        print(f"Debug: Document data to save: {document_data}")
        documents_collection.insert_one(document_data)
        
        return {
            "message": "File uploaded successfully",
            "file_id": file_id,
            "filename": filename
        }
    
    except Exception as e:
        print(f"Upload error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.get("/api/documents")
async def get_documents(section: str = None, subcategory: str = None):
    try:
        query = {}
        if section:
            query["section"] = section
        if subcategory:
            query["subcategory"] = subcategory
        
        print(f"Debug: Query parameters - section: {section}, subcategory: {subcategory}")
        print(f"Debug: MongoDB query: {query}")
        
        documents = list(documents_collection.find(query, {"_id": 0}))
        print(f"Debug: Found {len(documents)} documents")
        
        return documents
    
    except Exception as e:
        print(f"Error in get_documents: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching documents: {str(e)}")

@app.get("/api/documents/{file_id}")
async def get_document(file_id: str):
    try:
        document = documents_collection.find_one({"id": file_id}, {"_id": 0})
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")
        
        file_path = os.path.join(UPLOAD_DIR, document["filename"])
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not found")
        
        return FileResponse(
            file_path,
            media_type=document["file_type"],
            filename=document["original_filename"]
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching document: {str(e)}")

@app.get("/api/chat/messages")
async def get_chat_messages(limit: int = 50):
    try:
        messages = list(messages_collection.find(
            {},
            {"_id": 0}
        ).sort("timestamp", -1).limit(limit))
        
        # Reverse to show oldest first
        messages.reverse()
        return messages
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching messages: {str(e)}")

@app.websocket("/api/chat/ws/{user_name}")
async def websocket_endpoint(websocket: WebSocket, user_name: str):
    await manager.connect(websocket, user_name)
    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            
            # Create message object
            chat_message = {
                "user": user_name,
                "message": message_data["message"],
                "timestamp": datetime.now().isoformat()
            }
            
            # Save message to database
            messages_collection.insert_one(chat_message.copy())
            
            # Broadcast to all connected users
            await manager.broadcast({
                "type": "message",
                **chat_message
            })
            
    except WebSocketDisconnect:
        disconnected_user = manager.disconnect(websocket)
        if disconnected_user:
            await manager.broadcast({
                "type": "user_left",
                "user": disconnected_user,
                "timestamp": datetime.now().isoformat()
            })

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)