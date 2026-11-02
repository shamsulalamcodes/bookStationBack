import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const port = process.env.PORT || 5000;
const app = express()

// Adds headers: Access-Control-Allow-Origin: *
app.use(cors())
app.use(express.json())


const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}
// Call this only when your application terminates
// export async function disconnectFromMongoDB() {
//   await client.close();
// }
connectToMongoDB()

const db = client.db('bookStore');
const booksCollection = db.collection('bookStore')

app.get('/', async (req, res) => {
    const books = await booksCollection.find().toArray()
    res.send(books);
});

app.get('/books/:id', async (req, res) => {
    const { id } = req.params;
    const book = await booksCollection.findOne({ _id: new ObjectId(id) });
    res.send(book);
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});

export default app;