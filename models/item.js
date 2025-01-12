import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema({ 
    name: String,
    description: String })

const itemModel = mongoose.model("Item", itemSchema)

module.exports = itemModel


//mongodb+srv://PradeepKoirala:<db_password>@cluster0.tdy09.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0