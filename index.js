import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';
import { jwtVerify, createRemoteJWKSet } from 'jose'
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
const borrowCollection = db.collection('borrows')

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const [, token] = authHeader ? authHeader.split(' ') : [null, null];

    if (!token) return res.status(401).send({ message: "Unauthorized" });

    try {
        const { payload } = await jwtVerify(token, createRemoteJWKSet(
            new URL('http://localhost:3000/api/auth/jwks')
        ))
        req.user = payload;
        next();
    } catch (error) {
        console.error('Token validation failed:', error)
        return res.status(401).send({ message: "Unauthorized" });
    }
};

app.get('/books', async (req, res) => {
    const books = await booksCollection.find().toArray()
    res.send(books);
});

app.get('/books/latest', async (req, res) => {
    const book = await booksCollection.find().limit(8).toArray();
    res.send(book);
});

app.get('/categories', async (req, res) => {
    const categories = await booksCollection.distinct('category')
    res.send(categories);
});

app.get('/borrows', verifyToken, async (req, res) => {
    const borrows = await borrowCollection
        .find({ "userEmail": req.user.email })
        .toArray()
    res.send(borrows)
});

app.get('/books/mine', verifyToken, async (req, res) => {
    const books = await booksCollection
        .find({ addedBy: { email: req.user.email } })
        .toArray()
    res.send(books)
})

app.post('/books', verifyToken, async (req, res) => {
    const book = req.body;
    const userEmail = req.user.email;
    book.userEmail = userEmail;

    const alreadyAdded = await booksCollection.findOne({
        "addedBy.email": userEmail,
        "title": book.title
    });

    if (alreadyAdded) {
        return res.status(400).send({ message: "You have already added this book." });
    }

    const result = await booksCollection.insertOne(book);
    res.send(result);
});

app.post('/borrows', verifyToken, async (req, res) => {
    const borrow = req.body;
    const userEmail = req.user.email;
    borrow.userEmail = userEmail;

    const alreadyBorrowed = await borrowCollection.findOne({
        "userEmail": userEmail,
        "bookId": borrow.bookId
    });

    if (alreadyBorrowed) {
        return res.status(400).send({ message: "You have already borrowed this book." });
    }

    const result = await borrowCollection.insertOne(borrow);
    res.send(result);
});

app.get('/books/:id', async (req, res) => {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid book id" })
    }
    const book = await booksCollection.findOne({ _id: new ObjectId(id) });
    res.send(book);
});

app.patch('/books/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const { title, author, category } = req.body;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid book id" });
    }

    const result = await booksCollection.updateOne(
        { _id: new ObjectId(id), addedBy: { email: req.user.email } },
        { $set: { title, author, category } }
    );
    console.log('result from book patch ', result);
    if (result.matchedCount === 0) {
        return res.status(404).send({ message: "Book not found or not owned by user" });
    }

    res.send(result);
});

app.delete('/books/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid book id" })
    }

    const result = await booksCollection.deleteOne({ _id: new ObjectId(id), addedBy: { email: req.user.email } });
    res.send(result);
});

app.delete('/borrows/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid borrow id" })
    }

    const result = await borrowCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});

export default app;