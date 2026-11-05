import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config'
import cors from 'cors'
import { jwtVerify, createRemoteJWKSet } from 'jose'

const app = express();
app.use(express.json())
app.use(cors())
const PORT = process.env.PORT

const client = new MongoClient(process.env.MONGO);

export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    console.log(authHeader);

    const [, token] = authHeader ? authHeader.split(' ') : [null, null];

    // if (authHeader !== 'user signed in') return res.status(401).send({ message: "Unauthorized" });
    if (!token) return res.status(401).send({ message: "Unauthorized" });

    try {
        const { payload } = await jwtVerify(token, createRemoteJWKSet(new URL('http://localhost:3000/api/auth/jwks')))
        console.log(payload);
        next()
    } catch (error) {
        console.error('Token validation failed:', error);
        return res.status(401).send({ message: "Unauthorized" });
    }


}

const connectMongo = await connectToMongoDB()
const db = connectMongo.db('wanderlast')

const destinationCollection = db.collection('destination')
const bookingsCollection = db.collection('bookings')


app.get('/', (req, res) => {
    res.send('app got')
})

app.get('/destinations', async (req, res) => {
    console.log("object");
    const resd = await destinationCollection.find().toArray()
    res.send(resd)
})

app.get('/destinations/:id', verifyToken, async (req, res) => {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid destination id" });
    }

    const dresd = await destinationCollection.findOne({ _id: new ObjectId(id) });

    if (!dresd) {
        return res.status(404).send({ message: "Destination not found" });
    }

    res.send(dresd)
})

app.post('/destinations', verifyToken, async (req, res) => {
    const dataObj = req.body
    const fond = await destinationCollection.findOne({ name: dataObj.name })
    if (fond) {
        return res.status(400).send({ message: "Destination already exists" });
    }
    const result = await destinationCollection.insertOne(dataObj)
    res.send(result)
})

app.patch('/destinations/:id', async (req, res) => {
    const { id } = req.params
    const dataObj = req.body

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid destination id" });
    }

    const result = await destinationCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: dataObj }
    );
    res.json(result);
})

app.delete('/destinations/:id', async (req, res) => {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid destination id" });
    }

    const result = await destinationCollection.deleteOne({ _id: new ObjectId(id) });
    res.json(result);
})

app.post('/bookings', async (req, res) => {
    const dataObj = req.body
    const found = await bookingsCollection.findOne({ email: dataObj.email, _id: new ObjectId(dataObj._id) })
    if (found) {
        return res.status(400).send({ message: "Booking already exists for this email and destination" });
    }
    const result = await bookingsCollection.insertOne(dataObj)
    res.send(result)
})

app.get('/bookings', async (req, res) => {
    const resd = await bookingsCollection.find().toArray()
    res.send(resd)
})

app.get('/bookings/:email', async (req, res) => {
    const { email } = req.params
    const booking = await bookingsCollection.find({ email: email }).toArray()
    res.send(booking)
})

app.delete('/bookings/:id', async (req, res) => {
    const { id } = req.params

    if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid booking id" })

    const result = await bookingsCollection.deleteOne({
        $or: [{ _id: new ObjectId(id) }, { _id: id }],
    });
    res.json(result);
});

app.listen(PORT, () => {
    console.log('server running');
})